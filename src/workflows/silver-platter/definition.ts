import type { WorkflowDefinition } from "../types";

// Stage IDs echo the canonical Silver Platter skill's own stage vocabulary
// (/home/apexaipc/.claude/skills/silver-platter/SKILL.md) so a later phase can
// extend this first slice without renaming already-answered stages. This
// mini-app slice implements only a small subset of the canonical interview;
// see the product-boundary note on each step below for what is deliberately
// out of scope here.
export const SILVER_PLATTER_WORKFLOW_ID = "silver-platter";
export const SILVER_PLATTER_SCHEMA_VERSION = "1.0";

export const SILVER_PLATTER_STEP_IDS = {
  speed: "1_speed",
  archetype: "2_archetype",
  pantry: "3_pantry",
  shape: "shape_confirm",
  name: "name_automation",
} as const;

// Canonical archetype slugs from the /silver-platter skill's Stage 2 match
// list (references/archetypes.md), plus the skill's own "other" fallback.
// Kept here, not in the generic wizard engine, because the engine treats
// `answers` as workflow-owned (contract rule 5) and never validates content.
export const SILVER_PLATTER_ARCHETYPES = [
  {
    value: "ecommerce",
    label: "Ecommerce, sell physical or digital products online",
  },
  { value: "saas", label: "SaaS, recurring software subscription" },
  {
    value: "professional_services",
    label: "Professional services (law, accounting, consulting)",
  },
  {
    value: "healthcare_clinic",
    label: "Healthcare clinic, regulated patient-facing practice",
  },
  {
    value: "wealth_advisory",
    label: "Wealth advisory, boutique investment or family office",
  },
  {
    value: "content_creator",
    label: "Content creator, newsletter, YouTube, podcast, or course",
  },
  {
    value: "restaurant_multilocation",
    label: "Restaurant, multi-location food service",
  },
  {
    value: "real_estate_brokerage",
    label: "Real estate brokerage, agent or small team",
  },
  {
    value: "local_trades",
    label: "Local trades (HVAC, plumbing, landscaping, cleaning)",
  },
  { value: "other", label: "Something else" },
] as const;

export type SilverPlatterArchetype =
  (typeof SILVER_PLATTER_ARCHETYPES)[number]["value"];

export function isSupportedSilverPlatterArchetype(
  value: unknown,
): value is SilverPlatterArchetype {
  return (
    typeof value === "string" &&
    SILVER_PLATTER_ARCHETYPES.some((archetype) => archetype.value === value)
  );
}

// Named Stage 2 handoff per the blueprint's "Required handoff mapping"
// table: `2_archetype.business_description` and `2_archetype.confirmed_archetype`
// must survive as named fields, not anonymous answer keys, and an
// unsupported archetype slug must be rejected rather than passed through.
export type SilverPlatterStage2Handoff = {
  businessDescription: string;
  confirmedArchetype: SilverPlatterArchetype;
};

export function mapStage2Handoff(
  answers: Record<string, unknown>,
): SilverPlatterStage2Handoff | null {
  const businessDescription = answers.business_description;
  if (typeof businessDescription !== "string" || !businessDescription.trim()) {
    return null;
  }

  const confirmedArchetype = answers.confirmed_archetype;
  if (!isSupportedSilverPlatterArchetype(confirmedArchetype)) {
    return null;
  }

  return { businessDescription, confirmedArchetype };
}

// This mini-app cannot inspect the operator's local project (no filesystem or
// skill execution authority in the browser), so it never claims a workspace
// audit occurred here. That is the canonical skill's `audit-existing` branch,
// which is explicitly out of scope for this slice. The opening step instead
// shows the operator that limitation in plain language and asks the
// existing-setup questions as ordinary validated interview fields (the Mini
// App's Stage 0 boundary), rather than an invented separate stage id, so
// `entryStage: "1_speed"` frozen on the card record (src/types.ts) stays
// accurate.
export const silverPlatterWorkflow: WorkflowDefinition = {
  id: SILVER_PLATTER_WORKFLOW_ID,
  schemaVersion: SILVER_PLATTER_SCHEMA_VERSION,
  title: "Silver Platter",
  steps: [
    {
      id: SILVER_PLATTER_STEP_IDS.speed,
      title: "Choose your pace",
      description:
        "About 80% of building an AI system for your work is getting your data and tasks organized first. This short interview maps that out and tells you what to automate first. This mini app can't see your project folder or anything you've already set up on your computer, nothing local gets scanned, changed, or run from here, so tell us what's already in place.",
      fields: [
        {
          key: "pace",
          label: "How much explanation do you want?",
          type: "select",
          required: true,
          options: [
            {
              value: "walkthrough",
              label: "Walkthrough, explain each step in plain English",
            },
            {
              value: "fast_track",
              label: "Fast track, I know my own work, keep it quick",
            },
          ],
        },
        {
          key: "existing_claude_code_usage",
          label: "Are you already using Claude Code for this work?",
          type: "select",
          required: true,
          options: [
            { value: "not_yet", label: "Not yet" },
            { value: "partially", label: "Partially, I've started" },
            { value: "yes", label: "Yes, it's already running" },
          ],
        },
        {
          key: "existing_automation",
          label: "What other automation runs today?",
          type: "textarea",
          required: true,
          help: "Zapier flows, scheduled jobs, scripts a developer set up. Even one counts. If nothing, just say so.",
          placeholder:
            "e.g. a Zap that posts new orders to Slack, or nothing yet",
        },
      ],
    },
    {
      id: SILVER_PLATTER_STEP_IDS.archetype,
      title: "Describe your business or work",
      description: "Just what you do and how it works day to day.",
      fields: [
        {
          key: "business_description",
          label: "Describe your business or work in 1-2 sentences.",
          type: "textarea",
          required: true,
          placeholder: "What you do, and how you make money or get it done.",
        },
        {
          key: "confirmed_archetype",
          label: "Which of these fits your business best?",
          type: "select",
          required: true,
          help: 'Pick the closest match. If nothing fits, choose "Something else."',
          options: SILVER_PLATTER_ARCHETYPES.map((archetype) => ({
            value: archetype.value,
            label: archetype.label,
          })),
        },
      ],
    },
    {
      id: SILVER_PLATTER_STEP_IDS.pantry,
      title: "Your hardest recurring task",
      fields: [
        {
          key: "hardest_task",
          label:
            "What's the single hardest, most-repeated task you'd love to take off your plate?",
          type: "textarea",
          required: true,
          help: "Think weekly or daily, something that eats real time.",
        },
      ],
    },
    {
      // Mini-app-specific triage step, not a canonical Silver Platter stage:
      // the full interview derives this from later tool-inventory and recipe
      // stages that are out of scope for this small first slice.
      id: SILVER_PLATTER_STEP_IDS.shape,
      title: "Confirm the automation shape",
      description:
        "A rough shape for now. You or a builder can refine it once this is handed off.",
      fields: [
        {
          key: "automation_shape",
          label: "Which shape fits this task best?",
          type: "select",
          required: true,
          options: [
            { value: "weekly_summary", label: "A weekly summary or report" },
            {
              value: "auto_draft",
              label: "An automatic draft or reply I review before sending",
            },
            {
              value: "reminder_check",
              label: "A reminder or recurring check",
            },
            { value: "other", label: "Something else" },
          ],
        },
      ],
    },
    {
      id: SILVER_PLATTER_STEP_IDS.name,
      title: "Name your automation",
      fields: [
        {
          key: "automation_name",
          label: "What should we call this automation?",
          type: "text",
          required: true,
          placeholder: "e.g. Weekly Client Digest",
          help: "You can rename it later.",
        },
      ],
    },
  ],
};
