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
*   PostgreSQL database server running.
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

### Testing the Authentication Flow

This section outlines the steps to test the complete authentication flow. You'll interact with the application using your browser and an API client like Postman or cURL.

| Step | Action                                                                | Client Interaction / URL                                           | Backend Endpoint Hit                      | Flow Description                                                                                                                                                                                                                            | Expected Outcome / Next Step                                                                                                                                                                                            |
| :--- | :-------------------------------------------------------------------- | :----------------------------------------------------------------- | :---------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **Initiate Google Login**                                             | Open browser to: `http://localhost:3000/api/auth/google`           | `GET /api/auth/google`                    | Backend's `GoogleStrategy` (via `AuthGuard('google')`) redirects the browser to Google's OAuth 2.0 consent screen.                                                                                                            | Browser is redirected to Google for authentication.                                                                                                                                                                     |
| 2    | **Authenticate with Google**                                        | Log in with your Google account and grant permissions on Google's page. | (Google's authentication servers)       | User authenticates with Google and authorizes your application to access their profile information (email, basic profile).                                                                                              | Google authenticates the user.                                                                                                                                                                                          |
| 3    | **Google Redirects to Backend Callback**                              | Google redirects browser to your configured callback URL.            | `GET /api/auth/google/callback`           | Backend's `GoogleStrategy` validates the Google response, finds or creates a user in your database, and attaches the user object to the request.                                                                            | User data is processed by the backend.                                                                                                                                                                                  |
| 4    | **Backend Generates Tokens & Redirects to Frontend**                  | (Automatic redirect from backend)                                  | (Internal: `AuthService.login`)         | The `AuthController` calls `AuthService` to generate JWT Access and Refresh tokens. The backend then redirects the browser to your `FRONTEND_BASE_URL` with these tokens appended in the URL fragment.                       | Browser is redirected to e.g., `http://localhost:3001/auth/callback#accessToken=xxx&refreshToken=yyy`. **Copy the `accessToken` and `refreshToken` from the browser's URL bar.**                                      |
| 5    | **Access Protected Route** <br/> (e.g., Get User Profile)             | API Client (Postman/cURL): <br/> `GET http://localhost:3000/api/users/me` <br/> Header: `Authorization: Bearer <accessToken>` | `GET /api/users/me`                       | Backend's `JwtAuthGuard` validates the `accessToken`. If valid, the `UsersController` fetches and returns the user's profile.                                                                                               | **200 OK** response with user profile JSON (e.g., `{ "id": "...", "email": "...", "username": "..." }`).                                                                                                                      |
| 6    | **Refresh Access Token** <br/> (Simulate access token expiry)         | API Client: <br/> `POST http://localhost:3000/api/auth/refresh` <br/> Header: `Content-Type: application/json` <br/> Body: `{ "refreshToken": "<refreshToken>" }` | `POST /api/auth/refresh`                  | Backend's `AuthService` validates the `refreshToken` (checks signature, expiry, and if it's revoked in the DB against the stored hash). If valid, a new `accessToken` is generated and returned.                         | **200 OK** response with `{ "accessToken": "<new_accessToken>" }`. Use this new token for future protected requests.                                                                                                 |
| 7    | **Logout**                                                            | API Client: <br/> `POST http://localhost:3000/api/auth/logout` <br/> Header: `Authorization: Bearer <valid_accessToken>` | `POST /api/auth/logout`                   | Backend's `JwtAuthGuard` validates the `accessToken`. The `AuthController` calls `AuthService` to revoke all refresh tokens associated with the user ID (from the access token) in the database.                               | **204 No Content** response. Client should clear its stored tokens.                                                                                                                                                       |
| 8    | **Verify Logout (Attempt Refresh)**                                   | API Client: <br/> `POST http://localhost:3000/api/auth/refresh` <br/> Header: `Content-Type: application/json` <br/> Body: `{ "refreshToken": "<original_refreshToken_used_in_step_6>" }` | `POST /api/auth/refresh`                  | Backend attempts to validate the `refreshToken`. Since it was revoked in step 7 (marked `isRevoked=true` in DB), the validation fails.                                                                                 | **401 Unauthorized** or **403 Forbidden** error (e.g., "No valid session found" or "Refresh token invalid"). This confirms server-side revocation was successful.                                                        |
| 9    | **Verify Access Token (Post-Logout, Pre-Expiry)**                     | API Client: <br/> `GET http://localhost:3000/api/users/me` <br/> Header: `Authorization: Bearer <accessToken_from_step_4_or_6>` | `GET /api/users/me`                       | If the access token used has *not yet naturally expired*, the backend's `JwtAuthGuard` will still validate it successfully because access tokens are stateless.                                                              | **200 OK** response with user profile. This is expected. Access tokens work until they expire; logout primarily invalidates the ability to get *new* access tokens. Client should have discarded this token at logout. |

---


### Testing the Authentication Flow

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

This project is UNLICENSED. (If you wish to apply a license, MIT is common for open-source boilerplates).