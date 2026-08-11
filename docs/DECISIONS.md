# Decision log


---

# Recovered decisions (claude-mem archive)

4 decisions recovered 2026-08-11 from the claude-mem store before it was pruned. Source window 2026-04-06 to 2026-06-11. Full archive with observations and session summaries: `C:\Projectsrchives\claude-mem-2026-08-11\`.

## 2026-06-10 — Dashclaw architectural vision: governed agent access to production infrastructure

Dashclaw will serve as central governance layer for coding agents accessing production services

- Dashclaw will govern agent access to Namecheap (domain purchase, DNS), Vercel (deployment, env vars), Neon (database provisioning), and Stripe (product/webhook creation)
- Governance features include policies, action approval workflows, risk score profiles, and activity monitoring
- User remains in approval loop while agents safely access production infrastructure
- Current dashclaw session is running in c:\projects\dashclaw

## 2026-06-10 — Governed production-launch architecture planned for offlocalai-mcp

Architecture for full product launch via MCP with DashClaw governance, purchase capability, and secret redaction

- Adding MCP tools for domain purchase (Namecheap), deployment (Vercel), database provisioning (Neon), and payment setup (Stripe)
- New purchase capability enforces approval requirement for domain purchases without policy override
- All actions route through runGuarded in src/actions.ts for DashClaw policy enforcement
- Secret redaction extended to postgres:// connection URIs and whsec_ Stripe webhook secrets
- Namecheap sandbox mode default-on until production API enabled on user account
- DNS setHosts mapped to env_change capability, Vercel/Stripe writes to write capability
- Version bump planned from 0.4.0 to 0.5.0
- fast-xml-parser dependency added for Namecheap XML-over-GET API parsing

Files: `C:\Projects\offlocalai-mcp\.supergoal\THINKING.md`

## 2026-06-10 — Six-phase roadmap created for production-launch MCP tooling

Detailed implementation plan with acceptance criteria for Namecheap, Neon, Vercel, and Stripe governed integrations

- Phase 1 extends type taxonomy with purchase capability and namecheap/neon provider IDs
- Phase 2 builds Neon provider with postgres:// URI redaction for listProjects, createProject, getConnectionUri actions
- Phase 3 builds Namecheap provider with sandbox toggle, XML parsing, and approval-clamped domain purchases
- Phase 4 completes Vercel (createProject, addProjectDomain) and Stripe (createWebhookEndpoint, listWebhookEndpoints) with whsec_ redaction
- Phase 5 delivers architecture.md explaining MCP and governance flow plus launch-playbook.md with exact tool ordering
- Phase 6 enforces npm run verify green, security sweep, and version bump to 0.5.0
- fast-xml-parser added as runtime dependency for Namecheap XML-over-GET API
- Namecheap error code 1011102 will map to IP whitelist re-enable message
- Registrant contact stored in offlocal config namecheap.registrant block with clear failure message if missing

Files: `C:\Projects\offlocalai-mcp\.supergoal\ROADMAP.md`

## 2026-06-10 — Strategic Pivot: Convert PR to Standalone DashClaw MCP Server

Decided to withdraw the open-source pull request and build a dedicated dashclaw-mcp instead of contributing upstream.

- Decision made to pull down the existing pull request and repackage the work as a standalone dashclaw-mcp server.
- Rationale: the accumulated additions are substantial enough to warrant a product of their own rather than a contribution to another repo.
- DashClaw MCP is envisioned as solving the "hardest part of shipping products" — the distribution/go-to-market layer that AI cannot autonomously handle.
- Target audience is builders/founders who struggle with product distribution, positioning it as a universal solution for a gap AI tooling cannot self-fill.
- The pivot aligns with a broader product thesis: AI can build, but humans (and tooling like DashClaw) must handle the go-to-market motion.

