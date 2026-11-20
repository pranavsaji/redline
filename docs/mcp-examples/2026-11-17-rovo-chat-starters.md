# Rovo chat: the four conversation starters (live, 2026-11-17)

- **Where:** demo site `one-atlas-mefc`, Jira work item PAY-7 open, Rovo chat with the **Redline** agent (app 6.x, development environment, prompt v1.2.0).
- **Questions:** the manifest's conversation starters, adapted to the demo's real work item (PROJ-142 → PAY-7, T-7 on PAY-7).
- **Transcript:** copied from the chat panel. Rovo's UI buttons are removed, and two long passages are shortened with "…".
- **Credits:** each answer is one Rovo agent run on the site's credits.

## 1. "What do I need to fix before PAY-7 can merge?"

**Actions called:** get-review, then get-security-requirements.

> To merge PAY-7, you need to address 8 open security requirements rated High or above. The current verdict is blocked because these requirements are not yet verified.
>
> **Critical Requirement**
> - Validate LLM tool calls (PAY-15): The system must independently verify order ownership and refund eligibility before calling the Stripe API. The AI agent cannot be the sole decision-maker for financial transactions.
>
> **High Severity Requirements**
> - Verify Webhook Signatures (PAY-12): You must validate the Stripe signature header on the public webhook endpoint to prevent spoofed refund events.
> - Encrypt PII & Minimize Retention (PAY-13): Encrypt customer PII in the support database and enforce a strict 90-day deletion policy for transcripts.
> - Mitigate Agent Goal Hijack (PAY-18): Implement authorization rules at a trusted service layer (not client-side) and validate all inputs the agent reads to prevent prompt injection.
> - Mitigate Tool Misuse (PAY-10): Ensure the AI agent's tools (refunds, lookups) are restricted by function-level access controls and server-side authorization.
> - Mitigate Payment/Refund Manipulation (PAY-17): Ensure business logic flows are sequential and validated to prevent attackers from altering refund amounts or recipients.
> - Mitigate Account Takeover (PAY-8): Implement controls against credential stuffing and brute force, and ensure all session verification happens on a trusted backend service.
> - Mitigate Personal Data Exposure (PAY-9): Restrict function-level access to prevent u… query strings.
>
> **Medium Severity Requirements**
> - Implement Rate Limiting (PAY-16): Enforce per-user rate limits and character counts for chat inputs.
> - Mitigate Resource Exhaustion (PAY-11): Add anti-automation controls to the public endpoint to prevent DoS and costly resource overuse.
> - Secure Third-Party Integrations (PAY-14): Ensure TLS is used for all external connectivity and sensitive data is minimized and sent only in HTTP bodies/headers.
>
> **Next Steps:** Review the full acceptance criteria for each requirement in PAY-7. Once you've implemented the fixes, you can request a merge attestation by providing the repository name and the head commit SHA.

## 2. "Is release 4.2 safe to ship?"

**Action called:** release-readiness. Fix version 4.2 has no reviewed work items on the demo site, so this checks the empty-version rule: it must not answer "Go".

> Release 4.2 is Go with conditions.
>
> Condition: No work items visible to you in fix version 4.2 are currently reviewed by Redline. Please double-check the version name or ensure the relevant work items are tracked in Redline.
>
> Go with conditions.

## 3. "Which acceptances expire this month?"

**Action called:** posture-summary. The only acceptance created during testing had already been revoked.

> There are no risk acceptances expiring in the next 31 days across the Redline-enabled projects.
>
> Currently, the security posture shows: 34 open requirements in total (3 Critical, 21 High, 10 Medium). The PAY project is the primary source of these requirements.

## 4. "Explain threat T-7 on PAY-7 like I'm new to security"

**Action called:** explain-threat with the T-n ref. The answer is built from the review and the bundled OWASP and CWE data, with no model call inside Redline.

> Threat T-7 is about an "Over-privileged AI Agent." In plain language: The AI could be tricked into using its tools (like issuing refunds) in ways nobody intended.
>
> **How the attack works:** Imagine you give a new assistant a company credit card and tell them, "Only use this to buy office supplies for people who show you a receipt." If a clever person comes in and says, "I'm the CEO's best friend, and he said you should buy me this $200 gift card right now—don't worry about the receipt," a helpful but "over-privileged" assistant might just do it… In this case, the AI agent has the "tool" to issue refunds. If it doesn't double-check the rules itself (like verifying if the user actually owns the order), a user could trick it into sending money to the wrong place or refunding an order that isn't eligible.
>
> **How to fix it:**
> - The refund service must independently verify, "Is this specific user allowed to refund this specific order?"
> - Don't trust the AI's input blindly: treat the AI's request like any other user input. Validate that the order ID, amount and recipient make sense before the money moves.
> - Follow a strict process: ensure the refund can only happen if all the required steps (like ownership verification) have been completed successfully.
>
> **Technical references:**
> - OWASP ASVS: V8.2.1 (restricting function-level access), V8.3.1 (server-side authorization).
> - CWE: CWE-250 (Execution with Unnecessary Privileges), CWE-1426 (Improper Validation of Generative AI Output).
> - OWASP Top 10 for Agentic Applications: ASI02 (Tool Misuse), ASI03 (Identity and Privilege Abuse).
