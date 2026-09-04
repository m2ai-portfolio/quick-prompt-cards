import { describe, expect, it } from "vitest";
import { silverPocketCard } from "../../prompts";
import {
  SILVER_POCKET_SCHEMA_VERSION,
  SILVER_POCKET_STEP_IDS,
  SILVER_POCKET_WORKFLOW_ID,
  silverPocketWorkflow,
} from "./definition";

function stepById(id: string) {
  const step = silverPocketWorkflow.steps.find(
    (candidate) => candidate.id === id,
  );
  if (!step) throw new Error(`step ${id} not found`);
  return step;
}

describe("silverPocketWorkflow definition", () => {
  it("matches the workflow metadata frozen on the card record", () => {
    expect(silverPocketWorkflow.id).toBe(SILVER_POCKET_WORKFLOW_ID);
    expect(silverPocketWorkflow.schemaVersion).toBe(
      SILVER_POCKET_SCHEMA_VERSION,
    );
    expect(silverPocketCard.workflow.id).toBe(silverPocketWorkflow.id);
    expect(silverPocketCard.workflow.schemaVersion).toBe(
      silverPocketWorkflow.schemaVersion,
    );
    expect(silverPocketCard.workflow.entryStage).toBe(
      silverPocketWorkflow.steps[0].id,
    );
  });

  it("uses Silver Pocket as the user-visible card and workflow name", () => {
    expect(silverPocketCard.title).toBe(
      "Silver Pocket: map your first automation",
    );
    expect(silverPocketWorkflow.title).toBe("Silver Pocket");
  });

  it("uses provider-neutral automation-definition questions", () => {
    const fields = silverPocketWorkflow.steps.flatMap((step) => step.fields);
    expect(fields.map((field) => field.key)).toEqual([
      "recurring_task",
      "process_trigger",
      "current_process",
      "inputs_and_tools",
      "desired_result",
      "human_review",
      "boundaries",
      "automation_name",
    ]);

    const shippedCopy = JSON.stringify({
      card: silverPocketCard,
      workflow: silverPocketWorkflow,
    });
    expect(shippedCopy).not.toMatch(
      /Claude|Anthropic|Silver Platter|archetype|pantry|project folder|local workspace|builder/i,
    );
  });

  it("covers task, process, inputs, review, and naming in order", () => {
    expect(silverPocketWorkflow.steps.map((step) => step.id)).toEqual([
      SILVER_POCKET_STEP_IDS.task,
      SILVER_POCKET_STEP_IDS.process,
      SILVER_POCKET_STEP_IDS.inputs,
      SILVER_POCKET_STEP_IDS.review,
      SILVER_POCKET_STEP_IDS.name,
    ]);
  });

  it("requires every field without collecting paths or credentials", () => {
    for (const step of silverPocketWorkflow.steps) {
      for (const field of step.fields) {
        expect(field.required).toBe(true);
        expect(field.key).not.toMatch(
          /path|file|cwd|directory|token|credential/i,
        );
      }
    }
  });

  it("asks for one task before requesting process details", () => {
    const taskStep = stepById(SILVER_POCKET_STEP_IDS.task);
    expect(taskStep.fields).toHaveLength(1);
    expect(taskStep.fields[0].label).toBe(
      "What recurring task do you want help with?",
    );
  });

  it("keeps consequential actions under explicit human control", () => {
    const reviewStep = stepById(SILVER_POCKET_STEP_IDS.review);
    expect(reviewStep.fields.map((field) => field.key)).toEqual([
      "human_review",
      "boundaries",
    ]);
    expect(JSON.stringify(reviewStep)).toMatch(/human control/i);
    expect(JSON.stringify(reviewStep)).toMatch(/never do on its own/i);
  });

  it("carries no server, execution, or filesystem authority in its data", () => {
    const copy = JSON.stringify(silverPocketWorkflow).toLowerCase();
    expect(copy).not.toMatch(/execute|skill_dir|localhost|https?:\/\//);
  });
});
