/**
 * Canonical stored-prompt catalog. This is the single source of truth for
 * prompt card content, readable by both the browser client (src/prompts.ts)
 * and, once A3 lands, the server-side posting adapter that resolves a
 * cardId to the prompt it must post into Telegram. Every prompt here is a
 * complete instruction with no `{{placeholder}}` tokens: cards that need
 * user-specific detail ask for it conversationally after they run.
 */

export type CatalogPromptCard = {
  id: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  prompt: string;
  example?: string;
};

export const promptCatalog: CatalogPromptCard[] = [
  {
    id: "clear-email",
    title: "Write a clear email",
    description:
      "Turn rough notes into a warm, polished email that gets to the point.",
    category: "Writing",
    tags: ["email", "message", "rewrite"],
    prompt: `I need help writing a clear, polished email. Before you draft it, ask me for whatever you don't already have: who is receiving it, what I need to say, and how it should sound. Once you have that, write a subject line followed by the email. Keep it concise, preserve every important fact I give you, end with a clear next step, and do not invent details.`,
    example:
      "Use this when you know what you want to say but need help making it clear and polished.",
  },
  {
    id: "rewrite-my-voice",
    title: "Rewrite this in my voice",
    description:
      "Clean up your wording without making it sound stiff or artificial.",
    category: "Writing",
    tags: ["rewrite", "voice", "tone"],
    prompt: `I want a draft rewritten so it sounds like me. Ask me to paste the draft, describe how I naturally sound, and tell you who is reading it, if you don't already know. Then rewrite it, keeping my meaning and important details, improving clarity and flow without adding hype, jargon, or facts I did not provide. Return only the finished version.`,
  },
  {
    id: "social-post",
    title: "Create a social post",
    description:
      "Shape one idea into a useful post without sounding promotional.",
    category: "Writing",
    tags: ["social", "post", "content"],
    prompt: `Help me turn one idea into a social post. Ask me for the idea, who should care about it, and where I'm posting it, if I haven't told you yet. Then write a post with a natural opening, one clear takeaway, and a simple closing question. Keep it specific and conversational, and do not use fake statistics, exaggerated claims, or more than three hashtags.`,
  },
  {
    id: "compare-options",
    title: "Compare my options",
    description:
      "Get a practical side-by-side comparison before making a decision.",
    category: "Decisions",
    tags: ["compare", "decision", "pros cons"],
    prompt: `Help me compare options before I decide. Ask me what the options are, what matters most to me, and what my situation is, if you don't already know. Then compare them using only relevant criteria, separate known facts from assumptions, identify the biggest trade-off, recommend the best fit for my situation, and list what I should verify before deciding.`,
  },
  {
    id: "think-through-decision",
    title: "Think through a decision",
    description:
      "Slow down a choice and uncover the trade-offs you may be missing.",
    category: "Decisions",
    tags: ["decision", "tradeoffs", "clarity"],
    prompt: `Help me think through a decision I'm facing. Ask me what I'm deciding, what outcome I want, and what worries me, if you don't already know. Then identify the real decision, the key trade-offs, which parts are reversible versus irreversible, what information is missing, and the smallest safe next step. Ask up to three follow-up questions only if the answers would materially change your recommendation.`,
  },
  {
    id: "explain-simply",
    title: "Explain something simply",
    description:
      "Understand an unfamiliar subject without jargon or unnecessary detail.",
    category: "Learning",
    tags: ["explain", "learn", "simple"],
    prompt: `Explain something to me in plain language. Ask me what topic I want explained, what I already know about it, and why I need to understand it, if you don't already know. Then start with the plain-English meaning, use one everyday example, explain the three most important ideas, and finish with common mistakes to avoid. Define any necessary technical term immediately.`,
  },
  {
    id: "study-guide",
    title: "Make a study guide",
    description: "Turn notes or source material into a focused learning plan.",
    category: "Learning",
    tags: ["study", "notes", "quiz"],
    prompt: `Help me build a study guide. Ask me to paste the material, tell you what I need to learn, and how much study time I have, if you don't already know. Then produce: essential concepts, plain-English explanations, a prioritized study sequence, five recall questions, and an answer key. Do not introduce facts absent from the material; label any helpful outside context separately.`,
  },
  {
    id: "research-topic",
    title: "Research a topic",
    description:
      "Get a focused research brief with sources, disagreements, and open questions.",
    category: "Research",
    tags: ["research", "sources", "facts"],
    prompt: `Research a topic for me. Ask me what should be researched, what I'll use it for, and any limits or preferences, if you don't already know. Then give me a concise, current brief: separate established facts, expert disagreement, and your inference. Cite reliable sources with direct links, include publication dates for time-sensitive claims, and finish with the most important unanswered questions.`,
  },
  {
    id: "review-website",
    title: "Review a website",
    description:
      "Understand what a website offers, who it serves, and what deserves scrutiny.",
    category: "Research",
    tags: ["website", "review", "business"],
    prompt: `Review a website for me. Ask me for the URL, what interests me about it, and any specific questions I have, if you don't already know. Then explain: what it does, target user, core offer, pricing if public, notable features, integrations or APIs, evidence supporting its claims, privacy or contractual concerns, and practical use cases. Distinguish observed facts from inference and link to the exact pages used.`,
  },
  {
    id: "summarize-document",
    title: "Summarize a document",
    description:
      "Pull decisions, obligations, and important details from a long document.",
    category: "Analysis",
    tags: ["summary", "document", "actions"],
    prompt: `Analyze a document for me. Ask me to paste or attach it and tell you what should get extra attention, if you don't already know. Then return: a five-bullet summary, important dates and numbers, decisions, obligations by person, risks or unclear language, and next actions. Quote the exact passage supporting each obligation or deadline, and write "not stated" instead of guessing.`,
  },
  {
    id: "find-missing-info",
    title: "Find what is missing",
    description: "Stress-test a plan, message, or idea before you act on it.",
    category: "Analysis",
    tags: ["review", "gaps", "questions"],
    prompt: `Stress-test something I've written or planned. Ask me what should be reviewed and what it should accomplish, if you don't already know. Then identify missing information, unsupported assumptions, vague language, likely reader questions, contradictions, and risks, prioritizing only gaps that could change the decision or outcome. Finish with a short revision checklist.`,
  },
  {
    id: "meeting-prep",
    title: "Prepare for a meeting",
    description:
      "Walk into a conversation with a goal, questions, and a clear next step.",
    category: "Planning",
    tags: ["meeting", "questions", "agenda"],
    prompt: `Prepare me for a meeting. Ask me what the meeting is about, who will be there, and what result I need, if you don't already know. Then create a short agenda, the five most useful questions, decisions that must be made, information I should bring, likely objections, and a closing statement that secures owners and next steps.`,
  },
  {
    id: "project-plan",
    title: "Plan a small project",
    description:
      "Turn an outcome into manageable steps with owners and checkpoints.",
    category: "Planning",
    tags: ["project", "plan", "steps"],
    prompt: `Help me plan a small project. Ask me what I'm trying to complete, when it must be done, and what people or resources are available, if you don't already know. Then work backward from the deadline and provide phases, concrete tasks, suggested owners, dependencies, checkpoints, and the next three actions. Keep the plan proportional to a small project and flag anything that could block completion.`,
  },
  {
    id: "brainstorm-ideas",
    title: "Brainstorm useful ideas",
    description:
      "Generate varied, realistic ideas instead of slight variations of one answer.",
    category: "Ideas",
    tags: ["brainstorm", "creative", "options"],
    prompt: `Brainstorm ideas with me. Ask me what I'm trying to solve or create, what limits must be respected, and what would make an idea good, if you don't already know. Then generate 12 genuinely different ideas across practical, creative, low-effort, and unconventional approaches. For each, give the concept, why it fits, and one drawback. Rank the strongest three at the end.`,
  },
  {
    id: "improve-offer",
    title: "Improve an offer",
    description:
      "Make an offer clearer by connecting a specific problem to a credible outcome.",
    category: "Business",
    tags: ["offer", "customer", "value"],
    prompt: `Help me improve an offer without inventing proof or guarantees. Ask me what I'm offering now, who it's for, and what painful problem it solves, if you don't already know. Then return: a one-sentence offer, the concrete outcome, what is included, what remains the buyer's responsibility, three likely objections, and the smallest credible next step. Flag any claim that needs evidence.`,
  },
];
