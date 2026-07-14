const admin = require("firebase-admin");

function initializeFirebaseAdmin() {
    if (admin.apps.length > 0) return;

    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const databaseURL = process.env.FIREBASE_DATABASE_URL;

    if (!serviceAccountJson || !databaseURL) {
        throw new Error("Missing Firebase Admin environment variables.");
    }

    const serviceAccount = JSON.parse(serviceAccountJson);

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: databaseURL
    });
}

function metersToMiles(meters) {
    return meters / 1609.344;
}

function isRunningActivity(activity) {
    const runningTypes = ["Run", "TrailRun", "VirtualRun"];

    return (
        runningTypes.includes(activity.type) ||
        runningTypes.includes(activity.sport_type)
    );
}

async function refreshAccessToken(user) {
    const clientId = process.env.STRAVA_CLIENT_ID;
    const clientSecret = process.env.STRAVA_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error("Missing Strava client ID or client secret.");
    }

    const response = await fetch("https://www.strava.com/oauth/token", {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "refresh_token",
            refresh_token: user.refreshToken
        })
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(`Failed to refresh token: ${JSON.stringify(data)}`);
    }

    return data;
}

async function getValidAccessToken(user, userRef) {
    const currentTime = Math.floor(Date.now() / 1000);

    if (user.accessToken && user.expiresAt && user.expiresAt > currentTime + 60) {
        return user.accessToken;
    }

    const refreshed = await refreshAccessToken(user);

    await userRef.update({
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token,
        expiresAt: refreshed.expires_at,
        updatedAt: new Date().toISOString()
    });

    return refreshed.access_token;
}

exports.handler = async function (event) {
    const syncKey = process.env.ADMIN_SYNC_KEY;

    if (!syncKey) {
        return {
            statusCode: 500,
            body: "Missing ADMIN_SYNC_KEY environment variable."
        };
    }

    if (event.queryStringParameters?.key !== syncKey) {
        return {
            statusCode: 401,
            body: "Unauthorized."
        };
    }

    try {
        initializeFirebaseAdmin();

        const db = admin.database();
        const usersSnapshot = await db.ref("stravaUsers").once("value");
        const users = usersSnapshot.val();

        if (!users) {
            await db.ref("clubMileage").update({
                totalMemberMiles: 0,
                lastSyncedAt: new Date().toISOString()
            });

            return {
                statusCode: 200,
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    message: "No connected Strava users found.",
                    connectedUsers: 0,
                    activitiesFetched: 0,
                    newActivities: 0,
                    milesAdded: 0,
                    skippedNotRun: 0,
                    skippedNoDistance: 0,
                    skippedDuplicate: 0,
                    totalMemberMiles: 0
                })
            };
        }

        let connectedUsers = 0;
        let activitiesFetched = 0;
        let newActivities = 0;
        let milesAdded = 0;
        let skippedNotRun = 0;
        let skippedNoDistance = 0;
        let skippedDuplicate = 0;

        for (const [athleteId, user] of Object.entries(users)) {
            connectedUsers += 1;

            const userRef = db.ref(`stravaUsers/${athleteId}`);
            const accessToken = await getValidAccessToken(user, userRef);

            const connectedAfter = user.connectedAt
                ? Math.floor(new Date(user.connectedAt).getTime() / 1000)
                : Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 30;

            const activitiesResponse = await fetch(
                `https://www.strava.com/api/v3/athlete/activities?per_page=50&after=${connectedAfter}`,
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`
                    }
                }
            );

            const activities = await activitiesResponse.json();

            if (!activitiesResponse.ok) {
                throw new Error(
                    `Failed to fetch activities for athlete ${athleteId}: ${JSON.stringify(activities)}`
                );
            }

            activitiesFetched += activities.length;

            for (const activity of activities) {
                if (!isRunningActivity(activity)) {
                    skippedNotRun += 1;
                    continue;
                }

                if (!activity.distance || activity.distance <= 0) {
                    skippedNoDistance += 1;
                    continue;
                }

                const activityId = String(activity.id);
                const activityRef = db.ref(`stravaActivities/${activityId}`);
                const existingActivity = await activityRef.once("value");

                if (existingActivity.exists()) {
                    skippedDuplicate += 1;
                    continue;
                }

                const distanceMiles = metersToMiles(activity.distance);

                await activityRef.set({
                    activityId: activityId,
                    athleteId: String(athleteId),
                    athleteName: user.athleteName || "Unnamed Athlete",
                    name: activity.name || "Strava Run",
                    type: activity.type || null,
                    sportType: activity.sport_type || null,
                    distanceMeters: activity.distance,
                    distanceMiles: Number(distanceMiles.toFixed(2)),
                    movingTime: activity.moving_time || null,
                    startDate: activity.start_date || null,
                    startDateLocal: activity.start_date_local || null,
                    counted: true,
                    syncedAt: new Date().toISOString()
                });

                newActivities += 1;
                milesAdded += distanceMiles;
            }

            await userRef.update({
                lastSyncedAt: new Date().toISOString()
            });
        }

        const allActivitiesSnapshot = await db.ref("stravaActivities").once("value");
        const allActivities = allActivitiesSnapshot.val() || {};

        const totalMemberMiles = Object.values(allActivities).reduce((total, activity) => {
            if (!activity.counted) return total;

            const miles = Number(activity.distanceMiles) || 0;
            return total + miles;
        }, 0);

        await db.ref("clubMileage").update({
            totalMemberMiles: Number(totalMemberMiles.toFixed(2)),
            lastSyncedAt: new Date().toISOString()
        });

        return {
            statusCode: 200,
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                message: "Strava sync complete.",
                connectedUsers: connectedUsers,
                activitiesFetched: activitiesFetched,
                newActivities: newActivities,
                milesAdded: Number(milesAdded.toFixed(2)),
                skippedNotRun: skippedNotRun,
                skippedNoDistance: skippedNoDistance,
                skippedDuplicate: skippedDuplicate,
                totalMemberMiles: Number(totalMemberMiles.toFixed(2))
            })
        };
    } catch (err) {
        console.error(err);

        return {
            statusCode: 500,
            body: `Server error: ${err.message}`
        };
    }
};