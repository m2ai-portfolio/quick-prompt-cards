import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  ImportResponse,
  LocalRecord,
  PromptRecord,
} from "../../shared/pocket-contract";
import {
  countLocalPocket,
  describeLocalPocket,
  importLocalPocket,
  planLocalImport,
  verifyImport,
  type ImportOutcome,
} from "../local-migration";
import type { PromptCard } from "../types";
import LocalPocketMigration from "./LocalPocketMigration";

const starter: PromptCard = {
  id: "clear-email",
  kind: "prompt",
  title: "Write a clear email",
  description: "d",
  category: "Writing",
  tags: [],
  prompt: "canonical text",
  action: {
    type: "prompt-delivery",
    preferred: "telegram-webapp-query",
    fallback: "clipboard",
  },
};

function serverRecord(id: string): PromptRecord {
  return {
    id,
    source: "personal",
    canonicalCardId: null,
    title: "t",
    category: "Pinned",
    prompt: "p",
    hidden: false,
    revision: 1,
    createdAt: "",
    updatedAt: "",
  };
}

describe("countLocalPocket / describeLocalPocket", () => {
  it("counts pins, edits, and deletes with a deleted card not double-counted as edited", () => {
    const counts = countLocalPocket(
      [
        { id: "pinned-a", title: "A", prompt: "a" },
        { id: "pinned-b", title: "B", prompt: "b" },
        { id: "pinned-c", title: "C", prompt: "c" },
      ],
      {
        edits: {
          "clear-email": {
            id: "clear-email",
            title: "x",
            category: "Writing",
            prompt: "y",
          },
          other: { id: "other", title: "x", category: "Writing", prompt: "y" },
        },
        deletedIds: ["other"],
      },
    );
    expect(counts).toEqual({ pinned: 3, edited: 1, deleted: 1 });
    expect(describeLocalPocket(counts)).toBe(
      "3 pinned prompts, 1 edited card, 1 deleted card",
    );
  });

  it("omits zero parts and uses singular forms", () => {
    expect(describeLocalPocket({ pinned: 1, edited: 0, deleted: 0 })).toBe(
      "1 pinned prompt",
    );
    expect(describeLocalPocket({ pinned: 0, edited: 2, deleted: 0 })).toBe(
      "2 edited cards",
    );
    expect(describeLocalPocket({ pinned: 0, edited: 0, deleted: 0 })).toBe("");
  });
});

describe("planLocalImport", () => {
  it("maps pins to personal records and edits/deletes to canonical overrides", () => {
    const records = planLocalImport(
      [{ id: "pinned-notes", title: "Notes", prompt: "Summarize." }],
      {
        edits: {
          "clear-email": {
            id: "clear-email",
            title: "Follow up",
            category: "Business",
            prompt: "my words",
          },
        },
        deletedIds: [],
      },
      [starter],
    );
    expect(records).toEqual<LocalRecord[]>([
      {
        localId: "pin:pinned-notes",
        source: "personal",
        title: "Notes",
        category: "Pinned",
        prompt: "Summarize.",
      },
      {
        localId: "edit:clear-email",
        source: "canonical-override",
        canonicalCardId: "clear-email",
        title: "Follow up",
        category: "Business",
        prompt: "my words",
      },
    ]);
  });

  it("turns a deleted starter card into a hidden override with the canonical text, and drops unknown ids", () => {
    const records = planLocalImport(
      [],
      { edits: {}, deletedIds: ["clear-email", "gone-card"] },
      [starter],
    );
    expect(records).toEqual<LocalRecord[]>([
      {
        localId: "delete:clear-email",
        source: "canonical-override",
        canonicalCardId: "clear-email",
        title: "Write a clear email",
        category: "Writing",
        prompt: "canonical text",
        hidden: true,
      },
    ]);
  });

  it("a card both edited and deleted yields one hidden override carrying the edit", () => {
    const records = planLocalImport(
      [],
      {
        edits: {
          "clear-email": {
            id: "clear-email",
            title: "Edited",
            category: "Writing",
            prompt: "edited text",
          },
        },
        deletedIds: ["clear-email"],
      },
      [starter],
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      localId: "delete:clear-email",
      hidden: true,
      title: "Edited",
      prompt: "edited text",
    });
  });
});

describe("verifyImport / importLocalPocket", () => {
  const sent: LocalRecord[] = [
    {
      localId: "pin:a",
      source: "personal",
      title: "A",
      category: "Pinned",
      prompt: "a",
    },
    {
      localId: "pin:b",
      source: "personal",
      title: "B",
      category: "Pinned",
      prompt: "b",
    },
  ];

  it("passes when every local id is imported or skipped and the readback has each mapped id (duplicate case)", () => {
    const response: ImportResponse = {
      imported: ["pin:a"],
      skipped: ["pin:b"],
      mapping: { "pin:a": "S1", "pin:b": "S-existing" },
      records: [serverRecord("S1")],
    };
    expect(
      verifyImport(sent, response, [
        serverRecord("S1"),
        serverRecord("S-existing"),
      ]),
    ).toEqual({ ok: true });
  });

  it("fails when a local id is missing from the response", () => {
    const response: ImportResponse = {
      imported: ["pin:a"],
      skipped: [],
      mapping: { "pin:a": "S1" },
      records: [],
    };
    expect(verifyImport(sent, response, [serverRecord("S1")])).toEqual({
      ok: false,
      reason: "unmapped_local_ids",
    });
  });

  it("fails when the readback lacks a mapped record", () => {
    const response: ImportResponse = {
      imported: ["pin:a", "pin:b"],
      skipped: [],
      mapping: { "pin:a": "S1", "pin:b": "S2" },
      records: [],
    };
    expect(verifyImport(sent, response, [serverRecord("S1")])).toEqual({
      ok: false,
      reason: "missing_from_readback",
    });
  });

  it("importLocalPocket never throws: server error, readback error, then success on retry", async () => {
    const importLocal = vi
      .fn()
      .mockRejectedValueOnce(new Error("500"))
      .mockResolvedValue({
        imported: ["pin:a", "pin:b"],
        skipped: [],
        mapping: { "pin:a": "S1", "pin:b": "S2" },
        records: [],
      });
    const reload = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue([serverRecord("S1"), serverRecord("S2")]);

    await expect(
      importLocalPocket(sent, { importLocal, reload }),
    ).resolves.toEqual({ ok: false, reason: "import_failed" });
    await expect(
      importLocalPocket(sent, { importLocal, reload }),
    ).resolves.toEqual({ ok: false, reason: "readback_failed" });
    await expect(
      importLocalPocket(sent, { importLocal, reload }),
    ).resolves.toEqual({ ok: true, imported: 2, skipped: 0 });
  });
});

describe("<LocalPocketMigration>", () => {
  const renderDialog = (
    counts = { pinned: 3, edited: 1, deleted: 0 },
    onImport: () => Promise<ImportOutcome> = vi
      .fn()
      .mockResolvedValue({ ok: true, imported: 4, skipped: 0 }),
  ) => {
    const onSkip = vi.fn();
    const onNever = vi.fn();
    const onImported = vi.fn();
    render(
      <LocalPocketMigration
        counts={counts}
        onImport={onImport}
        onSkip={onSkip}
        onNever={onNever}
        onImported={onImported}
      />,
    );
    return { onSkip, onNever, onImported };
  };

  it("zero: renders nothing when there is no local data", () => {
    renderDialog({ pinned: 0, edited: 0, deleted: 0 });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("one: shows the exact singular count and moves focus to the heading", () => {
    renderDialog({ pinned: 1, edited: 0, deleted: 0 });
    expect(
      screen.getByText(/This device holds 1 pinned prompt\./),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Move your prompts into your pocket?",
      }),
    ).toHaveFocus();
  });

  it("many: shows the exact counts and uploads only on Import", async () => {
    const user = userEvent.setup();
    const onImport = vi
      .fn()
      .mockResolvedValue({ ok: true, imported: 3, skipped: 1 });
    const { onImported } = renderDialog(
      { pinned: 3, edited: 1, deleted: 0 },
      onImport,
    );
    expect(
      screen.getByText(/This device holds 3 pinned prompts, 1 edited card\./),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).not.toHaveTextContent("Beth");
    expect(onImport).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    expect(onImported).toHaveBeenCalledWith({
      ok: true,
      imported: 3,
      skipped: 1,
    });
    expect(onImport).toHaveBeenCalledTimes(1);
  });

  it("duplicate: a fully skipped import still counts as done", async () => {
    const user = userEvent.setup();
    const { onImported } = renderDialog(
      { pinned: 2, edited: 0, deleted: 0 },
      vi.fn().mockResolvedValue({ ok: true, imported: 0, skipped: 2 }),
    );
    await user.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() =>
      expect(onImported).toHaveBeenCalledWith({
        ok: true,
        imported: 0,
        skipped: 2,
      }),
    );
  });

  it("interrupted then retried: a server error keeps local data and offers Try again; the retry completes", async () => {
    const user = userEvent.setup();
    const onImport = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: "import_failed" })
      .mockResolvedValueOnce({ ok: true, imported: 3, skipped: 0 });
    const { onImported, onSkip, onNever } = renderDialog(
      { pinned: 3, edited: 0, deleted: 0 },
      onImport,
    );

    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't import. Your prompts are still on this device. Try again.",
    );
    expect(onImported).not.toHaveBeenCalled();
    expect(onSkip).not.toHaveBeenCalled();
    expect(onNever).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    expect(onImport).toHaveBeenCalledTimes(2);
  });

  it("a readback mismatch is surfaced, not treated as done", async () => {
    const user = userEvent.setup();
    const { onImported } = renderDialog(
      { pinned: 1, edited: 0, deleted: 0 },
      vi.fn().mockResolvedValue({ ok: false, reason: "missing_from_readback" }),
    );
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /didn't come back from the server/,
    );
    expect(onImported).not.toHaveBeenCalled();
  });

  it("disables every action while an import is in flight", async () => {
    const user = userEvent.setup();
    let resolveImport: (outcome: ImportOutcome) => void = () => {};
    const onImport = vi.fn(
      () =>
        new Promise<ImportOutcome>((resolve) => {
          resolveImport = resolve;
        }),
    );
    renderDialog({ pinned: 1, edited: 0, deleted: 0 }, onImport);
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(screen.getByRole("button", { name: "Importing…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Skip" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Never" })).toBeDisabled();
    resolveImport({ ok: true, imported: 1, skipped: 0 });
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Importing…" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("skipped: Skip calls onSkip without uploading", async () => {
    const user = userEvent.setup();
    const onImport = vi.fn();
    const { onSkip, onNever } = renderDialog(undefined, onImport);
    await user.click(screen.getByRole("button", { name: "Skip" }));
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onNever).not.toHaveBeenCalled();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("never: Never calls onNever without uploading", async () => {
    const user = userEvent.setup();
    const onImport = vi.fn();
    const { onSkip, onNever } = renderDialog(undefined, onImport);
    await user.click(screen.getByRole("button", { name: "Never" }));
    expect(onNever).toHaveBeenCalledTimes(1);
    expect(onSkip).not.toHaveBeenCalled();
    expect(onImport).not.toHaveBeenCalled();
  });
});
