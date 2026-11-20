# OWASP ASVS 5.0 map for Redline requirements

Redline maps every requirement to OWASP Application Security Verification Standard 5.0 ids (format `V<chapter>.<section>.<n>`). Use only ids listed here or returned by Redline; never invent one.

Source: https://github.com/OWASP/ASVS/releases/download/v5.0.0_release/OWASP_Application_Security_Verification_Standard_5.0.0_en.flat.json (OWASP, CC BY-SA 4.0). 345 requirements.

## Starting points by STRIDE category

### Spoofing

- **V6.3.1** (L1): Verify that controls to prevent attacks such as credential stuffing and password brute force are implemented according to the application's security documentation.
- **V6.2.1** (L1): Verify that user set passwords are at least 8 characters in length although a minimum of 15 characters is strongly recommended.
- **V7.2.1** (L1): Verify that the application performs all session token verification using a trusted, backend service.
- **V9.1.1** (L1): Verify that self-contained tokens are validated using their digital signature or MAC to protect against tampering before accepting the token's contents.

### Tampering

- **V2.2.1** (L1): Verify that input is validated to enforce business or functional expectations for that input. This should either use positive validation against an allow list of values, patterns, and ranges, or be based on comparing the input to an expected structure and logical limits according to predefined rules. For L1, this can focus on input which is used to make specific business or security decisions. For L2 and up, this should apply to all input.
- **V2.3.1** (L1): Verify that the application will only process business logic flows for the same user in the expected sequential step order and without skipping steps.
- **V1.2.1** (L1): Verify that output encoding for an HTTP response, HTML document, or XML document is relevant for the context required, such as encoding the relevant characters for HTML elements, HTML attributes, HTML comments, CSS, or HTTP header fields, to avoid changing the message or document structure.
- **V11.4.1** (L1): Verify that only approved hash functions are used for general cryptographic use cases, including digital signatures, HMAC, KDF, and random bit generation. Disallowed hash functions, such as MD5, must not be used for any cryptographic purpose.

### Repudiation

- **V16.3.1** (L2): Verify that all authentication operations are logged, including successful and unsuccessful attempts. Additional metadata, such as the type of authentication or factors used, should also be collected.
- **V16.2.1** (L2): Verify that each log entry includes necessary metadata (such as when, where, who, what) that would allow for a detailed investigation of the timeline when an event happens.
- **V16.4.1** (L2): Verify that all logging components appropriately encode data to prevent log injection.

### InformationDisclosure

- **V8.2.1** (L1): Verify that the application ensures that function-level access is restricted to consumers with explicit permissions.
- **V14.2.1** (L1): Verify that sensitive data is only sent to the server in the HTTP message body or header fields, and that the URL and query string do not contain sensitive information, such as an API key or session token.
- **V8.3.1** (L1): Verify that the application enforces authorization rules at a trusted service layer and doesn't rely on controls that an untrusted consumer could manipulate, such as client-side JavaScript.
- **V13.4.1** (L1): Verify that the application is deployed either without any source control metadata, including the .git or .svn folders, or in a way that these folders are inaccessible both externally and to the application itself.

### DenialOfService

- **V2.4.1** (L2): Verify that anti-automation controls are in place to protect against excessive calls to application functions that could lead to data exfiltration, garbage-data creation, quota exhaustion, rate-limit breaches, denial-of-service, or overuse of costly resources.
- **V4.3.1** (L2): Verify that a query allowlist, depth limiting, amount limiting, or query cost analysis is used to prevent GraphQL or data layer expression Denial of Service (DoS) as a result of expensive, nested queries.
- **V5.2.1** (L1): Verify that the application will only accept files of a size which it can process without causing a loss of performance or a denial of service attack.

### ElevationOfPrivilege

- **V8.2.1** (L1): Verify that the application ensures that function-level access is restricted to consumers with explicit permissions.
- **V8.3.1** (L1): Verify that the application enforces authorization rules at a trusted service layer and doesn't rely on controls that an untrusted consumer could manipulate, such as client-side JavaScript.
- **V8.4.1** (L2): Verify that multi-tenant applications use cross-tenant controls to ensure consumer operations will never affect tenants with which they do not have permissions to interact.

## Chapters and sections

### V1 Encoding and Sanitization

- V1.1 Encoding and Sanitization Architecture (2 requirements)
- V1.2 Injection Prevention (10 requirements)
- V1.3 Sanitization (12 requirements)
- V1.4 Memory, String, and Unmanaged Code (3 requirements)
- V1.5 Safe Deserialization (3 requirements)

### V2 Validation and Business Logic

- V2.1 Validation and Business Logic Documentation (3 requirements)
- V2.2 Input Validation (3 requirements)
- V2.3 Business Logic Security (5 requirements)
- V2.4 Anti-automation (2 requirements)

### V3 Web Frontend Security

- V3.1 Web Frontend Security Documentation (1 requirement)
- V3.2 Unintended Content Interpretation (3 requirements)
- V3.3 Cookie Setup (5 requirements)
- V3.4 Browser Security Mechanism Headers (8 requirements)
- V3.5 Browser Origin Separation (8 requirements)
- V3.6 External Resource Integrity (1 requirement)
- V3.7 Other Browser Security Considerations (5 requirements)

### V4 API and Web Service

- V4.1 Generic Web Service Security (5 requirements)
- V4.2 HTTP Message Structure Validation (5 requirements)
- V4.3 GraphQL (2 requirements)
- V4.4 WebSocket (4 requirements)

### V5 File Handling

- V5.1 File Handling Documentation (1 requirement)
- V5.2 File Upload and Content (6 requirements)
- V5.3 File Storage (3 requirements)
- V5.4 File Download (3 requirements)

### V6 Authentication

- V6.1 Authentication Documentation (3 requirements)
- V6.2 Password Security (12 requirements)
- V6.3 General Authentication Security (8 requirements)
- V6.4 Authentication Factor Lifecycle and Recovery (6 requirements)
- V6.5 General Multi-factor authentication requirements (8 requirements)
- V6.6 Out-of-Band authentication mechanisms (4 requirements)
- V6.7 Cryptographic authentication mechanism (2 requirements)
- V6.8 Authentication with an Identity Provider (4 requirements)

### V7 Session Management

- V7.1 Session Management Documentation (3 requirements)
- V7.2 Fundamental Session Management Security (4 requirements)
- V7.3 Session Timeout (2 requirements)
- V7.4 Session Termination (5 requirements)
- V7.5 Defenses Against Session Abuse (3 requirements)
- V7.6 Federated Re-authentication (2 requirements)

### V8 Authorization

- V8.1 Authorization Documentation (4 requirements)
- V8.2 General Authorization Design (4 requirements)
- V8.3 Operation Level Authorization (3 requirements)
- V8.4 Other Authorization Considerations (2 requirements)

### V9 Self-contained Tokens

- V9.1 Token source and integrity (3 requirements)
- V9.2 Token content (4 requirements)

### V10 OAuth and OIDC

- V10.1 Generic OAuth and OIDC Security (2 requirements)
- V10.2 OAuth Client (3 requirements)
- V10.3 OAuth Resource Server (5 requirements)
- V10.4 OAuth Authorization Server (16 requirements)
- V10.5 OIDC Client (5 requirements)
- V10.6 OpenID Provider (2 requirements)
- V10.7 Consent Management (3 requirements)

### V11 Cryptography

- V11.1 Cryptographic Inventory and Documentation (4 requirements)
- V11.2 Secure Cryptography Implementation (5 requirements)
- V11.3 Encryption Algorithms (5 requirements)
- V11.4 Hashing and Hash-based Functions (4 requirements)
- V11.5 Random Values (2 requirements)
- V11.6 Public Key Cryptography (2 requirements)
- V11.7 In-Use Data Cryptography (2 requirements)

### V12 Secure Communication

- V12.1 General TLS Security Guidance (5 requirements)
- V12.2 HTTPS Communication with External Facing Services (2 requirements)
- V12.3 General Service to Service Communication Security (5 requirements)

### V13 Configuration

- V13.1 Configuration Documentation (4 requirements)
- V13.2 Backend Communication Configuration (6 requirements)
- V13.3 Secret Management (4 requirements)
- V13.4 Unintended Information Leakage (7 requirements)

### V14 Data Protection

- V14.1 Data Protection Documentation (2 requirements)
- V14.2 General Data Protection (8 requirements)
- V14.3 Client-side Data Protection (3 requirements)

### V15 Secure Coding and Architecture

- V15.1 Secure Coding and Architecture Documentation (5 requirements)
- V15.2 Security Architecture and Dependencies (5 requirements)
- V15.3 Defensive Coding (7 requirements)
- V15.4 Safe Concurrency (4 requirements)

### V16 Security Logging and Error Handling

- V16.1 Security Logging Documentation (1 requirement)
- V16.2 General Logging (5 requirements)
- V16.3 Security Events (4 requirements)
- V16.4 Log Protection (3 requirements)
- V16.5 Error Handling (4 requirements)

### V17 WebRTC

- V17.1 TURN Server (2 requirements)
- V17.2 Media (8 requirements)
- V17.3 Signaling (2 requirements)
