import { describe, expect, it } from "vitest";
import { silverPlatterCard } from "../../prompts";
import {
  SILVER_PLATTER_ARCHETYPES,
  SILVER_PLATTER_SCHEMA_VERSION,
  SILVER_PLATTER_STEP_IDS,
  SILVER_PLATTER_WORKFLOW_ID,
  isSupportedSilverPlatterArchetype,
  mapStage2Handoff,
  silverPlatterWorkflow,
} from "./definition";

function stepById(id: string) {
  const step = silverPlatterWorkflow.steps.find(
    (candidate) => candidate.id === id,
  );
  if (!step) throw new Error(`step ${id} not found`);
  return step;
}

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

  it("covers the full slice in order: pace, work description, hardest task, shape, name", () => {
    expect(silverPlatterWorkflow.steps.map((step) => step.id)).toEqual([
      SILVER_PLATTER_STEP_IDS.speed,
      SILVER_PLATTER_STEP_IDS.archetype,
      SILVER_PLATTER_STEP_IDS.pantry,
      SILVER_PLATTER_STEP_IDS.shape,
      SILVER_PLATTER_STEP_IDS.name,
    ]);
  });

  it("requires every field, and none are schema-shaped or filesystem-shaped", () => {
    for (const step of silverPlatterWorkflow.steps) {
      for (const field of step.fields) {
        expect(field.required).toBe(true);
        expect(field.key).not.toMatch(
          /path|file|cwd|directory|token|credential/i,
        );
      }
    }
  });

  it("keeps single-answer steps to exactly one field", () => {
    for (const id of [
      SILVER_PLATTER_STEP_IDS.pantry,
      SILVER_PLATTER_STEP_IDS.shape,
      SILVER_PLATTER_STEP_IDS.name,
    ]) {
      expect(stepById(id).fields).toHaveLength(1);
    }
  });

  it("shows the Mini App Stage 0 limitation in visible copy, not just a source comment", () => {
    const speedStep = stepById(SILVER_PLATTER_STEP_IDS.speed);
    expect(speedStep.description).toMatch(/can't see your project folder/i);
    expect(speedStep.description).toMatch(/nothing local gets scanned/i);
  });

  it("collects existing-setup answers as normal validated interview fields alongside pace", () => {
    const speedStep = stepById(SILVER_PLATTER_STEP_IDS.speed);
    expect(speedStep.fields).toHaveLength(3);
    expect(speedStep.fields.map((field) => field.key)).toEqual([
      "pace",
      "existing_claude_code_usage",
      "existing_automation",
    ]);

    const usageField = speedStep.fields.find(
      (field) => field.key === "existing_claude_code_usage",
    );
    expect(usageField?.required).toBe(true);
    expect(usageField?.type).toBe("select");
    expect(usageField?.options?.map((option) => option.value)).toEqual([
      "not_yet",
      "partially",
      "yes",
    ]);

    const automationField = speedStep.fields.find(
      (field) => field.key === "existing_automation",
    );
    expect(automationField?.required).toBe(true);
    expect(automationField?.type).toBe("textarea");
  });

  it("confirms a canonical archetype in Stage 2, not just the free-text description", () => {
    const archetypeStep = stepById(SILVER_PLATTER_STEP_IDS.archetype);
    expect(archetypeStep.fields).toHaveLength(2);
    expect(archetypeStep.fields.map((field) => field.key)).toEqual([
      "business_description",
      "confirmed_archetype",
    ]);

    const archetypeField = archetypeStep.fields[1];
    expect(archetypeField.type).toBe("select");
    expect(archetypeField.required).toBe(true);
    expect(archetypeField.options?.map((option) => option.value)).toEqual(
      SILVER_PLATTER_ARCHETYPES.map((archetype) => archetype.value),
    );
  });

  it("rejects unsupported archetype slugs and accepts every canonical one", () => {
    expect(isSupportedSilverPlatterArchetype("time_travel_agency")).toBe(false);
    expect(isSupportedSilverPlatterArchetype(undefined)).toBe(false);
    expect(isSupportedSilverPlatterArchetype(42)).toBe(false);
    for (const archetype of SILVER_PLATTER_ARCHETYPES) {
      expect(isSupportedSilverPlatterArchetype(archetype.value)).toBe(true);
    }
  });

  it("maps Stage 2 answers to a named handoff, not anonymous keys", () => {
    expect(
      mapStage2Handoff({
        business_description: "A two-person bakery that ships nationwide.",
        confirmed_archetype: "ecommerce",
      }),
    ).toEqual({
      businessDescription: "A two-person bakery that ships nationwide.",
      confirmedArchetype: "ecommerce",
    });
  });

  it("rejects a Stage 2 handoff missing the description or carrying an unsupported archetype", () => {
    expect(
      mapStage2Handoff({
        business_description: "",
        confirmed_archetype: "ecommerce",
      }),
    ).toBeNull();
    expect(
      mapStage2Handoff({
        business_description: "A two-person bakery.",
        confirmed_archetype: "not_a_real_archetype",
      }),
    ).toBeNull();
    expect(mapStage2Handoff({})).toBeNull();
  });

  it("wires Stage 2 validation into the production workflow runtime", () => {
    expect(
      silverPlatterWorkflow.validateAnswers?.(
        {
          business_description: "A two-person bakery.",
          confirmed_archetype: "ecommerce",
        },
        "completion",
      ),
    ).toEqual({});
    expect(
      silverPlatterWorkflow.validateAnswers?.(
        {
          business_description: "A two-person bakery.",
          confirmed_archetype: "not_a_real_archetype",
        },
        "completion",
      ),
    ).toHaveProperty("confirmed_archetype");
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
