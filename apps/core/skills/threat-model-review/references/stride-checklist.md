# STRIDE checklist

Use these questions to read a design or a change the way an attacker would. A threat is concrete when you can say who attacks, how, and what they get, and quote the design text that makes it possible.

## Spoofing: pretending to be someone or something else

- Who or what calls this component, and how does it prove who it is (session, token, signature, mTLS)?
- Can a webhook, callback or message be forged? Is its signature checked over the raw body, with a constant-time comparison and a timestamp window?
- Can a login, reset or invitation link be replayed, guessed or reused?
- Does the system trust a header (`X-Forwarded-For`, `X-User-Id`) that a client can set?

## Tampering: changing data or code without permission

- Which inputs reach a database query, shell, template, file path or deserializer? Are they validated against an allow-list and parameterised?
- Can a client change a price, quantity, role or owner id that the server should decide?
- Are files, packages and build artifacts integrity-checked?
- For AI features: can retrieved documents or tool output change the agent's instructions?

## Repudiation: denying an action happened

- Are security-relevant actions (login, permission change, payment, approval, override) logged with who, what, when and from where?
- Can a user or admin edit or delete those logs?
- Is there a record for automated and agent actions too?

## Information disclosure: exposing data to the wrong people

- What personal, payment, health or secret data is stored, logged, cached or sent to third parties?
- Can a user read another user's object by changing an id (IDOR)?
- Do errors, logs, analytics or AI prompts leak tokens, keys or personal data?
- Is data encrypted in transit and, where needed, at rest? Who holds the keys?

## Denial of service: making it unavailable

- What can an unauthenticated caller make expensive (large uploads, unbounded queries, regex, AI tokens)?
- Are there rate limits, timeouts, size limits and pagination?
- Can one tenant or one job starve the others?

## Elevation of privilege: doing more than allowed

- Is authorisation checked on the server for every action and object, not just in the UI?
- Can a lower role reach an admin route, a feature flag or an internal API?
- Do services, tokens and AI agents run with the least privilege they need?
- Can an agent call a tool that acts with more authority than the person who asked it?

## Severity

Score likelihood and impact from 1 to 5 each. Threatline derives severity from both. Prefer a few concrete, well-cited threats over many vague ones.
