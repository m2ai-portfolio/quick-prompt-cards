export type PromptDeliveryDependencies = {
  confirm: (prompt: string) => Promise<boolean>;
  sendWebAppQuery: (prompt: string) => Promise<void>;
  copyToClipboard: (prompt: string) => Promise<void>;
};

export async function deliverPrompt(
  prompt: string,
  dependencies: PromptDeliveryDependencies,
): Promise<{ status: "cancelled" }> {
  const confirmed = await dependencies.confirm(prompt);

  if (!confirmed) {
    return { status: "cancelled" };
  }

  throw new Error("Confirmed prompt delivery is not implemented yet");
}
