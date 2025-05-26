# NestJS Google OAuth & JWT Auth Boilerplate

<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

A minimal and production-ready NestJS boilerplate for quickly setting up User Authentication using Google OAuth 2.0 and JWT-based session management (Access & Refresh Tokens).

This boilerplate prioritizes Google OAuth as it offers a clean, secure, and user-friendly authentication method without the need for users to manage new passwords for your application.

## Features

*   **Google OAuth 2.0 Integration:** Secure login via Google.
*   **JWT-based Sessions:** Uses Access Tokens (short-lived) and Refresh Tokens (long-lived).
*   **Secure Refresh Token Storage:** Refresh tokens are hashed (bcrypt) and stored in the database, associated with the user, allowing for server-side revocation.
*   **Database:** PostgreSQL with Prisma ORM.
*   **Core Endpoints:**
    *   Google Login initiation (`/api/auth/google`)
    *   Google OAuth callback (`/api/auth/google/callback`)
    *   Token refresh (`/api/auth/refresh`)
    *   Logout (`/api/auth/logout`) - Invalidates refresh tokens on the server.
    *   Get current user profile (`/api/users/me`) - Protected.
*   **Configuration:** Easy setup via `.env` file.
*   **Validation:** Uses `class-validator` and `class-transformer`.

## Tech Stack

*   **Framework:** [NestJS](https://nestjs.com/)
*   **Language:** [TypeScript](https://www.typescriptlang.org/)
*   **Database:** [PostgreSQL](https://www.postgresql.org/)
*   **ORM:** [Prisma](https://www.prisma.io/)
*   **Authentication:** [Passport.js](http://www.passportjs.org/) (`passport-google-oauth20`, `passport-jwt`)
*   **Security:** `bcrypt` for hashing refresh tokens.
*   **Configuration:** `@nestjs/config`

## Getting Started

### Prerequisites

*   Node.js (LTS version recommended, e.g., v18+, v20+)
*   PNPM (or npm/yarn - adjust commands accordingly if not using pnpm)
*   PostgreSQL database server running. (I use docker to achieve this!)
*   **Google Cloud Platform (GCP) Project & OAuth 2.0 Credentials:**
    1.  **Create or Select a GCP Project:**
        *   Go to the [Google Cloud Console](https://console.cloud.google.com/).
        *   If you don't have a project, create one. Otherwise, select an existing project.
    2.  **Enable APIs (If necessary):**
        *   While basic OpenID scopes (`email`, `profile`) are often sufficient, ensure no further APIs like "Google People API" are strictly required by your intended user data retrieval if you expand beyond these scopes. For the current setup, this step is usually implicitly covered.
    3.  **Configure OAuth Consent Screen:**
        *   In the GCP Console, navigate to "APIs & Services" > "OAuth consent screen".
        *   Choose "User Type": **External** (for any Google Account user) is recommended for general applications.
        *   Click "CREATE".
        *   Fill in the required information: App name, User support email, Developer contact information.
        *   Click "SAVE AND CONTINUE" through the Scopes and Test Users sections. You can add test users if your app is in "Testing" publishing status to allow specific accounts to use the OAuth flow.
        *   Review the summary and go back to the dashboard.
    4.  **Create OAuth 2.0 Credentials:**
        *   Navigate to "APIs & Services" > "Credentials".
        *   Click "+ CREATE CREDENTIALS" > "OAuth client ID".
        *   For **Application type**, select "Web application".
        *   Give your OAuth client a **Name** (e.g., "My NestJS Auth App - Dev").
        *   Under **Authorized redirect URIs**, click "+ ADD URI". Enter your backend's callback URL. For local development with this boilerplate, it will be:
            `http://localhost:3000/api/auth/google/callback`
            (Adjust the port `3000` if your backend runs on a different one).
        *   Click "CREATE".
    5.  **Get Client ID and Client Secret:**
        *   A dialog will display your **Your Client ID** and **Your Client Secret**.
        *   **Copy these values immediately and store them securely.** You will need them for the `.env` file. You can also find them later by clicking on the created OAuth client ID in the "Credentials" list.

### Minimal Setup Steps

1.  **Clone the repository:**
    ```bash
    git clone <repository-url> nestjs-auth-app
    cd nestjs-auth-app
    ```

2.  **Install dependencies:**
    ```bash
    pnpm install
    ```

3.  **Set up Environment Variables:**
    *   Copy the example environment file:
        ```bash
        cp .env.example .env
        ```
    *   Edit the `.env` file with your specific credentials:
        ```dotenv
        # .env

        # PostgreSQL Connection URL
        DATABASE_URL="postgresql://YOUR_DB_USER:YOUR_DB_PASSWORD@YOUR_DB_HOST:YOUR_DB_PORT/your_db_name?schema=public"

        # Google OAuth Credentials
        GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID_FROM_GCP_CONSOLE
        GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_CLIENT_SECRET_FROM_GCP_CONSOLE
        GOOGLE_CALLBACK_URL=http://localhost:3000/api/auth/google/callback # Should match what you configured in GCP

        # JWT Configuration
        JWT_SECRET=generate_a_very_strong_random_secret_key_here # e.g., using: openssl rand -hex 32
        JWT_ACCESS_EXPIRATION=15m
        JWT_REFRESH_EXPIRATION=7d

        # Frontend URL (for redirects after successful login)
        FRONTEND_BASE_URL=http://localhost:3001 # Adjust to your frontend's development URL
        ```
        **Important:**
        *   Replace all placeholder values.
        *   Ensure the PostgreSQL database specified in `DATABASE_URL` exists or will be created by you.
        *   `JWT_SECRET` must be a long, random, and strong string.

4.  **Run Database Migrations:**
    This will create the `users` and `refresh_tokens` tables in your database based on `prisma/schema.prisma`.
    ```bash
    npx prisma migrate dev --name init
    ```

5.  **Run the application (development mode):**
    ```bash
    pnpm run start:dev
    ```
    The server should start, typically on `http://localhost:3000`. Check the console for the exact URL and any errors.

## Understanding the Authentication Flow (Google OAuth + JWT)

This boilerplate uses a common and secure pattern for letting users log in with their Google account and then access protected parts of your application. Here's a simplified breakdown of what happens:

**The Goal:** Securely verify a user's identity using Google and then give them temporary "keys" (tokens) to access your application without needing to re-enter their Google password for every request.

**The Flow in Layman's Terms:**

1.  **"Hi, I'd like to log in with Google." (User to Your App)**
    *   The user clicks a "Login with Google" button on your frontend application (not part of this backend boilerplate, but where this flow would start).
    *   Your frontend redirects the user to a special link on this backend server (`/api/auth/google`).

2.  **"Google, can you verify this user?" (Your Backend to Google)**
    *   Our backend server takes this request and says, "Okay, Google, please handle the login for this user."
    *   The backend then sends the user's browser over to Google's official login page.

3.  **"Are you really you?" (Google to User)**
    *   The user sees Google's familiar login screen. They enter their Google email and password *directly on Google's site* (your application never sees their Google password, which is very secure).
    *   Google asks the user, "This application (`[Your App Name]`) wants to know who you are and see your email address and basic profile info. Is that okay?"
    *   The user clicks "Allow" or "Yes."

4.  **"Okay, user is legit. Here's proof." (Google to Your Backend)**
    *   Once Google is happy, it sends the user's browser back to a special "callback" address on our backend server (`/api/auth/google/callback`).
    *   Along with this redirect, Google includes a temporary, secure "authorization code" or profile information saying, "Yes, this user is authenticated by me, and here's some basic info about them."

5.  **"Thanks, Google! Let me set this user up." (Your Backend Internal Work)**
    *   Our backend receives this confirmation from Google.
    *   It checks if this user (based on their Google ID or email) already has an account in our application's database.
        *   If yes, it just notes they've logged in again.
        *   If no, it creates a new account for them in our database using the info Google provided (like their name and email).
    *   Now, our backend needs to give the user's browser a way to prove they are logged into *our* application. It does this by creating two special digital "keys" called **tokens**:
        *   **Access Token:** A short-term key (like a temporary ID badge, e.g., valid for 15 minutes). This is what the user's browser will show to our backend for most requests to prove they are logged in.
        *   **Refresh Token:** A long-term key (like a more permanent but still revocable pass, e.g., valid for 7 days). If the Access Token expires, the browser can use this Refresh Token to get a *new* Access Token without making the user log in with Google all over again. This Refresh Token is stored securely (hashed) on our backend.

6.  **"Here are your keys for our app." (Your Backend to User's Browser via Frontend)**
    *   Our backend sends these two tokens (Access and Refresh) back to the user's browser. This is usually done by redirecting the browser to your frontend application, with the tokens included in the URL (often in the part after a `#` symbol, so they are handled by frontend JavaScript and not sent back to other servers).

7.  **"I'm logged in! Can I see my profile?" (User's Browser to Your Backend)**
    *   Now, when the user's browser wants to access a protected page on our backend (like `/api/users/me`), it includes the **Access Token** in the request (usually in a special `Authorization` header).
    *   Our backend checks this Access Token: "Is it valid? Is it from us? Has it expired?"
    *   If the Access Token is good, the backend provides the requested information.

8.  **"Oops, my Access Token expired!" (User's Browser Logic)**
    *   After a short while (e.g., 15 minutes), the Access Token expires. If the browser tries to use it, our backend will say, "Sorry, this key is too old."
    *   The browser then (usually automatically) takes the **Refresh Token** it stored earlier and sends it to a special address on our backend (`/api/auth/refresh`).

9.  **"Can I get a new Access Token with this Refresh Token?" (User's Browser to Your Backend)**
    *   Our backend checks the Refresh Token: "Is this a valid Refresh Token we issued? Is it still good (not expired and not revoked by a logout)?"
    *   If the Refresh Token is good, our backend issues a *brand new Access Token* and sends it back to the browser.
    *   The browser can now use this new Access Token to continue accessing protected resources.

10. **"I'm logging out." (User to Your App)**
    *   When the user clicks "Logout" on the frontend:
    *   The frontend tells our backend (`/api/auth/logout`), usually sending the current Access Token to identify the user.
    *   Our backend then "revokes" all the **Refresh Tokens** associated with that user in its database. This means those Refresh Tokens can no longer be used to get new Access Tokens.
    *   The frontend also clears its own stored copies of the Access and Refresh Tokens.

This system ensures that the user only has to enter their Google credentials once (with Google), and then your application uses secure, time-limited tokens to manage their session.

## Testing the Authentication Flow

You'll need a tool like Postman, Insomnia, or simply your web browser for some steps. A minimal frontend to handle the final redirect (to capture tokens from the URL fragment) is helpful but not strictly necessary for backend testing.

1.  **Initiate Google Login:**
    *   Open your web browser and navigate to: `http://localhost:3000/api/auth/google`
    *   You should be redirected to Google's login/consent screen.

2.  **Google Authentication & Callback:**
    *   Log in with a Google account (one that's registered as a test user if your GCP OAuth app is in "testing" mode). Grant permissions if prompted.
    *   Google will redirect you back to `http://localhost:3000/api/auth/google/callback`.
    *   The backend processes this and then redirects you to your `FRONTEND_BASE_URL` (e.g., `http://localhost:3001/auth/callback`) with `accessToken` and `refreshToken` in the URL fragment.
    *   **Example Redirect URL:** `http://localhost:3001/auth/callback#accessToken=xxx.yyy.zzz&refreshToken=aaa.bbb.ccc`
    *   **Action:** Carefully copy the `accessToken` and `refreshToken` values from your browser's address bar after this redirect.

3.  **Access a Protected Route (Get User Profile):**
    *   Using Postman/Insomnia or cURL:
        *   **Method:** `GET`
        *   **URL:** `http://localhost:3000/api/users/me`
        *   **Headers:**
            *   `Authorization`: `Bearer <your_copied_accessToken>`
    *   **Expected Response (200 OK):** Your user profile details (e.g., id, email, username).

4.  **Refresh Access Token:**
    *   Access tokens are short-lived (e.g., 15 minutes). When it expires, use the `refreshToken` to get a new one.
    *   Using Postman/Insomnia or cURL:
        *   **Method:** `POST`
        *   **URL:** `http://localhost:3000/api/auth/refresh`
        *   **Headers:**
            *   `Content-Type`: `application/json`
        *   **Body (JSON):**
            ```json
            {
              "refreshToken": "<your_copied_refreshToken>"
            }
            ```
    *   **Expected Response (200 OK):**
        ```json
        {
          "accessToken": "<new_accessToken>"
        }
        ```
    *   You can now use this `new_accessToken` for subsequent calls to protected routes.

5.  **Logout:**
    *   This action invalidates the refresh tokens on the server side. The client application is responsible for clearing its locally stored tokens.
    *   Using Postman/Insomnia or cURL:
        *   **Method:** `POST`
        *   **URL:** `http://localhost:3000/api/auth/logout`
        *   **Headers:**
            *   `Authorization`: `Bearer <current_valid_accessToken>`
            *   `Content-Type`: `application/json`
        *   **(Optional) Body (JSON):** While your current logout primarily uses the `userId` from the access token, the endpoint can accept a `refreshToken` in the body. For this test, an empty JSON body `{}` is fine if you're relying on the access token.
            ```json
            {}
            ```
            or
            ```json
            {
              "refreshToken": "<your_copied_refreshToken>"
            }
            ```
    *   **Expected Response:** `204 No Content`
    *   **Verification:** After a successful logout, attempt to use the *old* `refreshToken` with the `/api/auth/refresh` endpoint. This request should now fail (e.g., with a 401 or 403 error), demonstrating that the refresh token has been successfully revoked on the server. Note: The *access token* used for the logout call will remain technically valid until its natural expiry time.

---

## Directory Structure (Key Auth & User Parts)

```bash
nestjs-auth-boilerplate/
├── prisma/ # Prisma schema, migrations, and service
│ ├── migrations/ # Database migration files
│ │ ├── 2025..._init_auth_schema/
│ │ │ └── migration.sql
│ │ └── 2025..._add_user_password_field/
│ │ └── migration.sql
│ ├── prisma.module.ts
│ ├── prisma.service.ts
│ └── schema.prisma # Defines User and RefreshToken models
├── src/
│ ├── auth/ # Authentication logic (Google OAuth, JWT)
│ │ ├── auth.controller.ts
│ │ ├── auth.module.ts
│ │ ├── auth.service.ts
│ │ ├── decorators/
│ │ │ └── public.decorator.ts
│ │ ├── dto/
│ │ │ └── refresh-token.dto.ts
│ │ ├── guards/
│ │ │ └── jwt-auth.guard.ts
│ │ └── strategies/
│ │ ├── google.strategy.ts
│ │ └── jwt.strategy.ts
│ ├── users/ # User-related operations (e.g., fetching profile)
│ │ ├── users.controller.spec.ts
│ │ ├── users.controller.ts
│ │ ├── users.module.ts
│ │ ├── users.service.spec.ts
│ │ └── users.service.ts
│ ├── app.controller.spec.ts # (Optional) Root controller tests
│ ├── app.controller.ts # (Optional) Root controller
│ ├── app.module.ts # Root application module
│ ├── app.service.ts # (Optional) Root service
│ └── main.ts # Application entry point
├── test/ # E2E tests
│ ├── app.e2e-spec.ts
│ └── jest-e2e.json
├── .env # Local environment variables (Git ignored)
├── .env.example # Example environment variables
├── .eslintrc.js
├── .gitignore
├── .prettierrc
├── nest-cli.json
├── package.json
├── pnpm-lock.yaml # Or package-lock.json / yarn.lock
├── tsconfig.build.json
└── tsconfig.json
```


---

## Further Development

Once you have this boilerplate set up, you can extend it in several ways:

*   **Implement Traditional Email/Password Authentication:**
    *   Add password hashing (e.g., using `bcrypt`) during user registration.
    *   Create a `LocalStrategy` for Passport.js to handle email/password logins.
    *   Add registration (`/auth/register`) and login (`/auth/login`) endpoints.
*   **Role-Based Access Control (RBAC):**
    *   Add a `roles` field to your `User` model.
    *   Create custom guards to check user roles for accessing specific routes or performing certain actions.
*   **Enhanced User Profile Management:**
    *   Add more fields to the `User` model (e.g., bio, preferences).
    *   Implement endpoints for users to update their full profile.
*   **Two-Factor Authentication (2FA):**
    *   Integrate libraries like `speakeasy` or services for OTP generation and verification.
*   **Social Logins for Other Providers:**
    *   Add Passport strategies for Facebook, Twitter, GitHub, etc.
*   **API Rate Limiting:**
    *   Use `@nestjs/throttler` to protect against abuse.
*   **Comprehensive Logging:**
    *   Integrate a more robust logging library (e.g., Winston, Pino) for better production monitoring.
*   **Testing:**
    *   Write thorough unit tests for services and controllers.
    *   Expand e2e tests to cover all authentication flows and protected endpoints.
*   **Refresh Token Rotation:**
    *   For enhanced security, implement a strategy where a new refresh token is issued (and the old one invalidated or marked for one-time use) every time a refresh token is used to get a new access token.
*   **Account Linking:**
    *   Allow users who initially signed up with Google to later add an email/password, or vice-versa, linking them to the same user account.
*   **Password Reset Functionality:**
    *   Implement a secure flow for users to reset their passwords if you add email/password auth (e.g., using email-based tokens).
*   **Admin Panel/Dashboard:**
    *   Create separate modules and guards for administrative functionalities.

## License

This project is UNLICENSED.