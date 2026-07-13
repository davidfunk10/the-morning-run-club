exports.handler = async function (event) {
    const code = event.queryStringParameters?.code;
    const error = event.queryStringParameters?.error;

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

        const athlete = data.athlete;
        const athleteName = `${athlete.firstname || ""} ${athlete.lastname || ""}`.trim();

        return {
            statusCode: 200,
            headers: {
                "Content-Type": "text/html"
            },
            body: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Strava Connected</title>
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
            <h1>Strava Connected</h1>
            <p>${athleteName || "Your Strava account"} was connected successfully.</p>
            <p>This is the first test connection. Mileage syncing will be added next.</p>
            <a href="/mileage-tracker.html">Return to Mileage Tracker</a>
          </div>
        </body>
        </html>
      `
        };
    } catch (err) {
        return {
            statusCode: 500,
            body: `Server error: ${err.message}`
        };
    }
};