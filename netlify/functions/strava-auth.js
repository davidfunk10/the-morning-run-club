exports.handler = async function () {
    const clientId = process.env.STRAVA_CLIENT_ID;
    const redirectUri = process.env.STRAVA_REDIRECT_URI;

    if (!clientId || !redirectUri) {
        return {
            statusCode: 500,
            body: "Missing Strava environment variables."
        };
    }

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        approval_prompt: "auto",
        scope: "read,activity:read"
    });

    return {
        statusCode: 302,
        headers: {
            Location: `https://www.strava.com/oauth/authorize?${params.toString()}`
        }
    };
};