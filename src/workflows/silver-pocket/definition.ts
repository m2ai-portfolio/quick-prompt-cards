import type { WorkflowDefinition } from "../types";

export const SILVER_POCKET_WORKFLOW_ID = "silver-pocket";
export const SILVER_POCKET_SCHEMA_VERSION = "2.0";

export const SILVER_POCKET_STEP_IDS = {
  task: "task",
  process: "process",
  inputs: "inputs",
  review: "review",
  name: "name",
} as const;

export const silverPocketWorkflow: WorkflowDefinition = {
  id: SILVER_POCKET_WORKFLOW_ID,
  schemaVersion: SILVER_POCKET_SCHEMA_VERSION,
  title: "Silver Pocket",
  steps: [
    {
      id: SILVER_POCKET_STEP_IDS.task,
      title: "Choose the task",
      description:
        "Start with one recurring task that takes too much time or attention.",
      fields: [
        {
          key: "recurring_task",
          label: "What recurring task do you want help with?",
          type: "textarea",
          required: true,
          help: "Pick one task you repeat often enough that improving it would matter.",
          placeholder: "e.g. Turn meeting notes into follow-up tasks",
        },
      ],
    },
    {
      id: SILVER_POCKET_STEP_IDS.process,
      title: "Map what happens today",
      description:
        "A simple description is enough. This helps define where the automation should begin and what it should replace or support.",
      fields: [
        {
          key: "process_trigger",
          label: "What starts this task?",
          type: "textarea",
          required: true,
          placeholder: "e.g. A client meeting ends",
        },
        {
          key: "current_process",
          label: "What do you do today from start to finish?",
          type: "textarea",
          required: true,
          placeholder: "List the main steps in plain language.",
        },
      ],
    },
    {
      id: SILVER_POCKET_STEP_IDS.inputs,
      title: "Define the inputs and result",
      fields: [
        {
          key: "inputs_and_tools",
          label: "What information, apps, or tools are involved?",
          type: "textarea",
          required: true,
          help: "Include the source information and where it lives. If no app is required, say so.",
          placeholder:
            "e.g. Meeting transcript in Google Drive and tasks in Notion",
        },
        {
          key: "desired_result",
          label: "What should the automation produce or update?",
          type: "textarea",
          required: true,
          placeholder: "Describe the finished result you want.",
        },
      ],
    },
    {
      id: SILVER_POCKET_STEP_IDS.review,
      title: "Set review and boundaries",
      description:
        "Keep important decisions under human control and state what the automation must not do by itself.",
      fields: [
        {
          key: "human_review",
          label: "What should a person review or approve?",
          type: "textarea",
          required: true,
          help: "If nothing needs review, say so explicitly.",
        },
        {
          key: "boundaries",
          label: "What should this automation never do on its own?",
          type: "textarea",
          required: true,
          help: "Examples: send messages, spend money, publish, delete, or change records. If none, say so.",
        },
      ],
    },
    {
      id: SILVER_POCKET_STEP_IDS.name,
      title: "Name your automation",
      fields: [
        {
          key: "automation_name",
          label: "What should we call this automation?",
          type: "text",
          required: true,
          placeholder: "e.g. Meeting Follow-Up Pocket",
          help: "You can rename it later.",
        },
      ],
    },
  ],
};
