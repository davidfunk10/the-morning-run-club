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

function htmlPage(title, heading, message, linkText = "Return to Mileage Tracker", linkHref = "/mileage-tracker.html") {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>${title}</title>
      <style>
        body {
          font-family: sans-serif;
          background: #f4f4f4;
          text-align: center;
          padding: 3rem 1rem;
        }

        .card {
          background: white;
          max-width: 600px;
          margin: auto;
          padding: 2rem;
          border-radius: 14px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        }

        h1 {
          color: #0a3d62;
        }

        a {
          color: #0a3d62;
          font-weight: bold;
        }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>${heading}</h1>
        <p>${message}</p>
        <a href="${linkHref}">${linkText}</a>
      </div>
    </body>
    </html>
  `;
}

exports.handler = async function (event) {
    const code = event.queryStringParameters?.code;
    const error = event.queryStringParameters?.error;
    const acceptedScope = event.queryStringParameters?.scope || "";

    if (error) {
        return {
            statusCode: 400,
            body: `Strava authorization failed: ${error}`
        };
    }

    if (!code) {
        return {
            statusCode: 400,
            body: "Missing authorization code from Strava."
        };
    }

    if (!acceptedScope.includes("activity:read")) {
        return {
            statusCode: 400,
            headers: {
                "Content-Type": "text/html"
            },
            body: htmlPage(
                "Strava Permission Required",
                "Activity Permission Required",
                "To count your runs toward the club mileage total, Morning Run Club needs permission to view your Strava activities. Please go back and keep “View data about your activities” checked.",
                "Try Connecting Again",
                "/.netlify/functions/strava-auth"
            )
        };
    }

    const clientId = process.env.STRAVA_CLIENT_ID;
    const clientSecret = process.env.STRAVA_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        return {
            statusCode: 500,
            body: "Missing Strava client ID or client secret."
        };
    }

    try {
        const tokenResponse = await fetch("https://www.strava.com/oauth/token", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                code: code,
                grant_type: "authorization_code"
            })
        });

        const data = await tokenResponse.json();

        if (!tokenResponse.ok) {
            return {
                statusCode: tokenResponse.status,
                body: `Strava token exchange failed: ${JSON.stringify(data)}`
            };
        }

        initializeFirebaseAdmin();

        const athlete = data.athlete;
        const athleteId = String(athlete.id);
        const athleteName = `${athlete.firstname || ""} ${athlete.lastname || ""}`.trim();

        await admin.database().ref(`stravaUsers/${athleteId}`).set({
            athleteId: athleteId,
            athleteName: athleteName || "Unnamed Athlete",
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: data.expires_at,
            scope: acceptedScope,
            connectedAt: new Date().toISOString()
        });

        return {
            statusCode: 200,
            headers: {
                "Content-Type": "text/html"
            },
            body: htmlPage(
                "Strava Connected",
                "Strava Connected",
                `${athleteName || "Your Strava account"} was connected successfully. Your account is now saved for future mileage syncing.`
            )
        };
    } catch (err) {
        console.error(err);

        return {
            statusCode: 500,
            body: `Server error: ${err.message}`
        };
    }
};