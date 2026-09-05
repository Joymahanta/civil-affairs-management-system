# Civil Affairs SMS Gateway

This companion Android app turns one office Android phone into the Civil Affairs SMS gateway.

## How it works

1. The Civil Affairs web app queues SMS jobs in SQLite.
2. The Android gateway polls `/api/sms/gateway/jobs` every 15 seconds.
3. The phone sends each message through its SIM using Android `SmsManager`.
4. The app reports success/failure to `/api/sms/gateway/result`.

No SMS API provider is used. The only SMS cost is whatever the SIM/mobile operator charges.

## Setup

1. Open the `android-gateway` folder in Android Studio.
2. Build and install the app on a dedicated Android phone with an active SIM.
3. Grant the SMS permission when Android asks.
4. Enter the Civil Affairs server URL.
5. Enter the same gateway token configured as `SMS_GATEWAY_TOKEN` on Render.
6. Tap **Start SMS Gateway**.

Keep the phone powered on, connected to the internet, and able to send SMS. For production, use a dedicated office phone and disable battery optimization for this app.

## Security

The gateway token is required for all phone-to-server gateway endpoints. Do not publish the token in source control.

## Current scope

The first version handles the existing **Send SMS update** action for all on-duty staff. Complaint-specific resident SMS templates can be added next without changing the gateway protocol.
