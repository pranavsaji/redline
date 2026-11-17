# OWASP Top 10 for Agentic Applications (2026) and for LLM Applications (2025)

Apply these on top of STRIDE whenever the design uses an LLM, an AI agent, retrieval (RAG) or tool calling. Map threats with the ids below.

## Agentic Applications (2026)

Source: https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/

- **ASI01 Agent Goal Hijack**: Malicious content in documents, tools or data redirects an agent's goals or decision path.
- **ASI02 Tool Misuse and Exploitation**: An agent uses legitimate tools in unsafe or unauthorised ways, often through manipulated inputs.
- **ASI03 Identity and Privilege Abuse**: Agents inherit, escalate or misuse identities, credentials and delegated privileges.
- **ASI04 Agentic Supply Chain Vulnerabilities**: Compromised tools, plugins, prompts, MCP servers or other agents are pulled into the agent at runtime.
- **ASI05 Unexpected Code Execution**: Agents generate or run code or commands that lead to remote code execution.
- **ASI06 Memory and Context Poisoning**: Attackers corrupt an agent's memory, context or retrieved knowledge to influence later actions.
- **ASI07 Insecure Inter-Agent Communication**: Messages between agents lack authentication, integrity or validation.
- **ASI08 Cascading Failures**: A single fault or compromise propagates through connected agents and workflows.
- **ASI09 Human-Agent Trust Exploitation**: Agents exploit or are used to exploit human trust, for example persuading users to approve harmful actions.
- **ASI10 Rogue Agents**: Compromised or misaligned agents act outside their intended scope.

## LLM Applications (2025)

Source: https://genai.owasp.org/llm-top-10/

- **LLM01 Prompt Injection**: Crafted input alters the model's behaviour or output in unintended ways, directly or through content the model reads.
- **LLM02 Sensitive Information Disclosure**: The model reveals personal data, credentials or confidential business data in its output.
- **LLM03 Supply Chain**: Compromised models, datasets, adapters or plugins introduce vulnerabilities.
- **LLM04 Data and Model Poisoning**: Training, fine-tuning or embedding data is manipulated to introduce backdoors or bias.
- **LLM05 Improper Output Handling**: Model output is passed to downstream systems without validation, enabling XSS, SQL injection or code execution.
- **LLM06 Excessive Agency**: The model is given more functionality, permissions or autonomy than it needs.
- **LLM07 System Prompt Leakage**: System prompts containing sensitive logic or secrets are exposed.
- **LLM08 Vector and Embedding Weaknesses**: Weaknesses in how embeddings are generated, stored or retrieved are exploited, including cross-tenant leakage in RAG.
- **LLM09 Misinformation**: The model produces false or misleading information that users or systems rely on.
- **LLM10 Unbounded Consumption**: Uncontrolled inference requests cause denial of service, cost blow-ups or model extraction.
