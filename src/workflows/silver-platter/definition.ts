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

// This mini-app cannot inspect the operator's local project (no filesystem or
// skill execution authority in the browser), so it never claims a workspace
// audit occurred here. That is the canonical skill's `audit-existing` branch,
// which is explicitly out of scope for this slice.
export const silverPlatterWorkflow: WorkflowDefinition = {
  id: SILVER_PLATTER_WORKFLOW_ID,
  schemaVersion: SILVER_PLATTER_SCHEMA_VERSION,
  title: "Silver Platter",
  steps: [
    {
      id: SILVER_PLATTER_STEP_IDS.speed,
      title: "Choose your pace",
      description:
        "About 80% of building an AI system for your work is getting your data and tasks organized first. This short interview maps that out and tells you what to automate first.",
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
