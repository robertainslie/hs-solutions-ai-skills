# HubSpot Solutions AI Skills

A library of reusable AI skills for HubSpot solutions teams, compatible with Claude Code, the HubSpot Agent CLI, and Anthropic Plugins.

## What's Here

Skills are organized by HubSpot domain:

| Package | Domain | Skills |
|---------|--------|--------|
| [`packages/crm`](packages/crm) | CRM & Data Model | [CRM Schema Audit](packages/crm/skills/crm-schema-audit) |
| `packages/marketing` | Marketing | _(coming soon)_ |
| `packages/sales` | Sales | _(coming soon)_ |
| `packages/cms` | CMS | _(coming soon)_ |
| `packages/operations` | Operations | _(coming soon)_ |

All skills are indexed in [`skills-index.json`](skills-index.json).

## Installation by Format

### Claude Code (recommended)

Copy a skill's `skill.md` into your project's `.claude/skills/` directory:

```bash
# Example: CRM Schema Audit
cp packages/crm/skills/crm-schema-audit/skill.md /your-project/.claude/skills/crm-schema-audit.md
```

Then invoke it in Claude Code:
```
/crm-schema-audit
```

### HubSpot Agent CLI

Each skill ships a `formats/agent-cli.md` compatible with the Agent CLI skills format.
(Note: `SKILL.md` and `skill.md` collide on case-insensitive filesystems like macOS, so the Agent CLI variant lives in `formats/`.)

```bash
# Reference the agent-cli.md alongside hubspot/agent-cli-skills
npx skills add hubspot/agent-cli-skills
# Then copy the Agent CLI variant into your skills directory:
cp packages/crm/skills/crm-schema-audit/formats/agent-cli.md ~/.skills/crm-schema-audit.md
```

### Anthropic Plugin

Each skill includes a `.claude-plugin/plugin.json` manifest and `commands/` directory:

```bash
# Point your plugin installer at a skill directory
claude plugin install ./packages/crm/skills/crm-schema-audit
```

## Authentication

Most skills require one or more of:

| Method | Usage |
|--------|-------|
| `HUBSPOT_ACCESS_TOKEN` | Direct REST API access — generate a Private App token in HubSpot Settings > Integrations > Private Apps |
| HubSpot CLI auth | `hubspot auth login` — required for CLI-based data collection |
| HubSpot DevEx MCP | `hs mcp setup` — for IDE-integrated workflows |

## Adding a New Skill

Use the template in `templates/new-skill/`:

```bash
cp -r templates/new-skill packages/<domain>/skills/<skill-name>
```

Then update `skills-index.json` with the new skill's metadata.

See the [template README](templates/new-skill/README.md) for the skill authoring guide.

## Repository Structure

```
solutions-ai-skills/
├── skills-index.json           # Machine-readable catalog of all skills
├── packages/
│   ├── crm/
│   │   └── skills/
│   │       └── crm-schema-audit/
│   │           ├── skill.md           # Claude Code format
│   │           ├── formats/
│   │           │   └── agent-cli.md   # Agent CLI format
│   │           ├── .claude-plugin/    # Plugin format
│   │           ├── commands/          # Plugin slash commands
│   │           ├── src/audit.js       # Implementation script
│   │           └── README.md
│   └── ...
└── templates/
    └── new-skill/              # Scaffold for new skills
```
