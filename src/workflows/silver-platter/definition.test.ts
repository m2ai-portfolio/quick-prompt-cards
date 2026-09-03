import { describe, expect, it } from "vitest";
import { silverPlatterCard } from "../../prompts";
import {
  SILVER_PLATTER_SCHEMA_VERSION,
  SILVER_PLATTER_STEP_IDS,
  SILVER_PLATTER_WORKFLOW_ID,
  silverPlatterWorkflow,
} from "./definition";

describe("silverPlatterWorkflow definition", () => {
  it("matches the workflow id, schema version, and entry stage frozen on the card record", () => {
    expect(silverPlatterWorkflow.id).toBe(SILVER_PLATTER_WORKFLOW_ID);
    expect(silverPlatterWorkflow.schemaVersion).toBe(
      SILVER_PLATTER_SCHEMA_VERSION,
    );
    expect(silverPlatterCard.workflow.id).toBe(silverPlatterWorkflow.id);
    expect(silverPlatterCard.workflow.schemaVersion).toBe(
      silverPlatterWorkflow.schemaVersion,
    );
    expect(silverPlatterCard.workflow.entryStage).toBe(
      silverPlatterWorkflow.steps[0].id,
    );
  });

  it("covers the full first slice in order: pace, work description, hardest task, shape, name", () => {
    expect(silverPlatterWorkflow.steps.map((step) => step.id)).toEqual([
      SILVER_PLATTER_STEP_IDS.speed,
      SILVER_PLATTER_STEP_IDS.archetype,
      SILVER_PLATTER_STEP_IDS.pantry,
      SILVER_PLATTER_STEP_IDS.shape,
      SILVER_PLATTER_STEP_IDS.name,
    ]);
  });

  it("requires exactly one answer per step, no schema-shaped or filesystem-shaped fields", () => {
    for (const step of silverPlatterWorkflow.steps) {
      expect(step.fields).toHaveLength(1);
      expect(step.fields[0].required).toBe(true);
      const key = step.fields[0].key;
      expect(key).not.toMatch(/path|file|cwd|directory|token|credential/i);
    }
  });

  it("asks the hardest-task question with the canonical wording, not an invented variant", () => {
    const pantryStep = silverPlatterWorkflow.steps.find(
      (step) => step.id === SILVER_PLATTER_STEP_IDS.pantry,
    );
    expect(pantryStep?.fields[0].label).toBe(
      "What's the single hardest, most-repeated task you'd love to take off your plate?",
    );
  });

  it("never claims a local workspace audit occurred", () => {
    const copy = JSON.stringify(silverPlatterWorkflow).toLowerCase();
    expect(copy).not.toMatch(/audit/);
    expect(copy).not.toMatch(/we found|already started building/);
  });

  it("carries no server, execution, or filesystem authority in its data", () => {
    const copy = JSON.stringify(silverPlatterWorkflow).toLowerCase();
    expect(copy).not.toMatch(/execute|skill_dir|claude_skill|localhost|http/);
  });
});
