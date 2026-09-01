import type { PromptCard } from "./types";

export const prompts: PromptCard[] = [
  {
    id: "clear-email",
    title: "Write a clear email",
    description:
      "Turn rough notes into a warm, polished email that gets to the point.",
    category: "Writing",
    tags: ["email", "message", "rewrite"],
    fields: [
      {
        key: "notes",
        label: "What do you need to say?",
        placeholder: "The appointment moved to Friday.",
        multiline: true,
      },
      {
        key: "recipient",
        label: "Who will receive it?",
        placeholder: "A client",
      },
      {
        key: "tone",
        label: "How should it sound?",
        placeholder: "Warm and professional",
      },
    ],
    template: `Turn my notes into a clear email.

Recipient: {{recipient}}
Tone: {{tone}}
Notes: {{notes}}

Keep it concise, preserve every important fact, and end with a clear next step. Provide a subject line followed by the email. Do not invent details.`,
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
    fields: [
      {
        key: "draft",
        label: "Paste your draft",
        placeholder: "Paste the message here",
        multiline: true,
      },
      {
        key: "voice",
        label: "How do you naturally sound?",
        placeholder: "Friendly, direct, and casual",
      },
      {
        key: "audience",
        label: "Who is reading it?",
        placeholder: "A coworker",
      },
    ],
    template: `Rewrite the draft below so it sounds like me.

My voice: {{voice}}
Audience: {{audience}}
Draft: {{draft}}

Keep my meaning and important details. Improve clarity and flow, but do not add hype, jargon, or facts I did not provide. Return only the finished version.`,
  },
  {
    id: "social-post",
    title: "Create a social post",
    description:
      "Shape one idea into a useful post without sounding promotional.",
    category: "Writing",
    tags: ["social", "post", "content"],
    fields: [
      {
        key: "idea",
        label: "What is the main idea?",
        placeholder: "Something I learned this week",
        multiline: true,
      },
      {
        key: "audience",
        label: "Who should care?",
        placeholder: "Small business owners",
      },
      {
        key: "platform",
        label: "Where will you post it?",
        placeholder: "Facebook",
      },
    ],
    template: `Create a {{platform}} post from this idea: {{idea}}

Audience: {{audience}}
Use a natural opening, one clear takeaway, and a simple closing question. Keep it specific and conversational. Do not use fake statistics, exaggerated claims, or more than three hashtags.`,
  },
  {
    id: "compare-options",
    title: "Compare my options",
    description:
      "Get a practical side-by-side comparison before making a decision.",
    category: "Decisions",
    tags: ["compare", "decision", "pros cons"],
    fields: [
      {
        key: "options",
        label: "What options are you considering?",
        placeholder: "Option A and Option B",
        multiline: true,
      },
      {
        key: "priorities",
        label: "What matters most?",
        placeholder: "Cost, ease of use, and reliability",
      },
      {
        key: "context",
        label: "What is your situation?",
        placeholder: "I need this for a small home business",
        multiline: true,
      },
    ],
    template: `Help me compare these options: {{options}}

My situation: {{context}}
My priorities: {{priorities}}

Compare them using only relevant criteria. Separate known facts from assumptions, identify the biggest trade-off, and recommend the best fit for my situation. List what I should verify before deciding.`,
  },
  {
    id: "think-through-decision",
    title: "Think through a decision",
    description:
      "Slow down a choice and uncover the trade-offs you may be missing.",
    category: "Decisions",
    tags: ["decision", "tradeoffs", "clarity"],
    fields: [
      {
        key: "decision",
        label: "What are you deciding?",
        placeholder: "Whether to change jobs",
        multiline: true,
      },
      {
        key: "goal",
        label: "What outcome do you want?",
        placeholder: "More flexibility without losing stability",
      },
      {
        key: "concerns",
        label: "What worries you?",
        placeholder: "Income and schedule changes",
        multiline: true,
      },
    ],
    template: `Help me think through this decision: {{decision}}

Desired outcome: {{goal}}
Concerns: {{concerns}}

Identify the real decision, key trade-offs, reversible versus irreversible parts, missing information, and the smallest safe next step. Ask up to three questions only if the answers would materially change the recommendation.`,
  },
  {
    id: "explain-simply",
    title: "Explain something simply",
    description:
      "Understand an unfamiliar subject without jargon or unnecessary detail.",
    category: "Learning",
    tags: ["explain", "learn", "simple"],
    fields: [
      {
        key: "topic",
        label: "What do you want explained?",
        placeholder: "How credit scores work",
      },
      {
        key: "level",
        label: "What do you already know?",
        placeholder: "Almost nothing",
      },
      {
        key: "reason",
        label: "Why do you need to understand it?",
        placeholder: "I am preparing to buy a car",
      },
    ],
    template: `Explain {{topic}} to someone who currently knows {{level}}.

Reason for learning: {{reason}}
Start with the plain-English meaning, use one everyday example, explain the three most important ideas, and finish with common mistakes to avoid. Define any necessary technical term immediately.`,
  },
  {
    id: "study-guide",
    title: "Make a study guide",
    description: "Turn notes or source material into a focused learning plan.",
    category: "Learning",
    tags: ["study", "notes", "quiz"],
    fields: [
      {
        key: "material",
        label: "Paste the material",
        placeholder: "Notes, article, or lesson text",
        multiline: true,
      },
      {
        key: "goal",
        label: "What do you need to learn?",
        placeholder: "The main concepts for a test",
      },
      {
        key: "time",
        label: "How much study time do you have?",
        placeholder: "45 minutes",
      },
    ],
    template: `Create a study guide from the material below.

Learning goal: {{goal}}
Available time: {{time}}
Material: {{material}}

Include: essential concepts, plain-English explanations, a prioritized study sequence, five recall questions, and an answer key. Do not introduce facts that are absent from the material; label any helpful outside context separately.`,
  },
  {
    id: "research-topic",
    title: "Research a topic",
    description:
      "Get a focused research brief with sources, disagreements, and open questions.",
    category: "Research",
    tags: ["research", "sources", "facts"],
    fields: [
      {
        key: "topic",
        label: "What should be researched?",
        placeholder: "Best ways to reduce household energy use",
      },
      {
        key: "purpose",
        label: "What will you use it for?",
        placeholder: "Deciding which home improvements to make",
      },
      {
        key: "constraints",
        label: "Any limits or preferences?",
        placeholder: "Budget under $1,000",
        multiline: true,
      },
    ],
    template: `Research this topic: {{topic}}

Purpose: {{purpose}}
Constraints: {{constraints}}

Give me a concise, current brief. Separate established facts, expert disagreement, and your inference. Cite reliable sources with direct links, include publication dates for time-sensitive claims, and finish with the most important unanswered questions.`,
  },
  {
    id: "review-website",
    title: "Review a website",
    description:
      "Understand what a website offers, who it serves, and what deserves scrutiny.",
    category: "Research",
    tags: ["website", "review", "business"],
    fields: [
      {
        key: "url",
        label: "What is the website?",
        placeholder: "https://example.com",
      },
      {
        key: "interest",
        label: "What interests you about it?",
        placeholder: "Whether it would help my business",
      },
      {
        key: "questions",
        label: "Any specific questions?",
        placeholder: "Pricing, integrations, privacy, and limitations",
        multiline: true,
      },
    ],
    template: `Review this website: {{url}}

My interest: {{interest}}
Questions: {{questions}}

Explain what it does, target user, core offer, pricing if public, notable features, integrations or APIs, evidence supporting its claims, privacy or contractual concerns, and practical use cases. Distinguish observed facts from inference and link to the exact pages used.`,
  },
  {
    id: "summarize-document",
    title: "Summarize a document",
    description:
      "Pull decisions, obligations, and important details from a long document.",
    category: "Analysis",
    tags: ["summary", "document", "actions"],
    fields: [
      {
        key: "document",
        label: "Paste or attach the document",
        placeholder: "Document text",
        multiline: true,
      },
      {
        key: "focus",
        label: "What should receive extra attention?",
        placeholder: "Deadlines, costs, and responsibilities",
      },
    ],
    template: `Analyze the attached or pasted document.

Priority: {{focus}}
Document: {{document}}

Return: a five-bullet summary, important dates and numbers, decisions, obligations by person, risks or unclear language, and next actions. Quote the exact passage supporting each obligation or deadline. Write “not stated” instead of guessing.`,
  },
  {
    id: "find-missing-info",
    title: "Find what is missing",
    description: "Stress-test a plan, message, or idea before you act on it.",
    category: "Analysis",
    tags: ["review", "gaps", "questions"],
    fields: [
      {
        key: "material",
        label: "What should be reviewed?",
        placeholder: "Paste the plan, message, or idea",
        multiline: true,
      },
      {
        key: "goal",
        label: "What should this accomplish?",
        placeholder: "Help someone approve the project",
      },
    ],
    template: `Review this material against its intended goal.

Goal: {{goal}}
Material: {{material}}

Identify missing information, unsupported assumptions, vague language, likely reader questions, contradictions, and risks. Prioritize only gaps that could change the decision or outcome. Then provide a short revision checklist.`,
  },
  {
    id: "meeting-prep",
    title: "Prepare for a meeting",
    description:
      "Walk into a conversation with a goal, questions, and a clear next step.",
    category: "Planning",
    tags: ["meeting", "questions", "agenda"],
    fields: [
      {
        key: "meeting",
        label: "What is the meeting about?",
        placeholder: "Planning a community event",
      },
      {
        key: "people",
        label: "Who will be there?",
        placeholder: "Organizer, venue owner, and volunteers",
      },
      {
        key: "outcome",
        label: "What result do you need?",
        placeholder: "Agree on the date and responsibilities",
      },
    ],
    template: `Prepare me for this meeting.

Topic: {{meeting}}
People: {{people}}
Desired outcome: {{outcome}}

Create a short agenda, the five most useful questions, decisions that must be made, information I should bring, likely objections, and a closing statement that secures owners and next steps.`,
  },
  {
    id: "project-plan",
    title: "Plan a small project",
    description:
      "Turn an outcome into manageable steps with owners and checkpoints.",
    category: "Planning",
    tags: ["project", "plan", "steps"],
    fields: [
      {
        key: "project",
        label: "What are you trying to complete?",
        placeholder: "Organize a neighborhood yard sale",
      },
      {
        key: "deadline",
        label: "When must it be done?",
        placeholder: "By October 15",
      },
      {
        key: "resources",
        label: "What people or resources are available?",
        placeholder: "Three volunteers and a $200 budget",
        multiline: true,
      },
    ],
    template: `Create a practical plan for this project: {{project}}

Deadline: {{deadline}}
Available resources: {{resources}}

Work backward from the deadline. Provide phases, concrete tasks, suggested owners, dependencies, checkpoints, and the next three actions. Keep the plan proportional to a small project and flag anything that could block completion.`,
  },
  {
    id: "brainstorm-ideas",
    title: "Brainstorm useful ideas",
    description:
      "Generate varied, realistic ideas instead of slight variations of one answer.",
    category: "Ideas",
    tags: ["brainstorm", "creative", "options"],
    fields: [
      {
        key: "challenge",
        label: "What are you trying to solve or create?",
        placeholder: "A low-cost family activity",
        multiline: true,
      },
      {
        key: "constraints",
        label: "What limits must be respected?",
        placeholder: "Indoors, under $30, suitable for children",
      },
      {
        key: "success",
        label: "What would make an idea good?",
        placeholder: "Easy to prepare and memorable",
      },
    ],
    template: `Brainstorm ideas for this challenge: {{challenge}}

Constraints: {{constraints}}
Success looks like: {{success}}

Generate 12 genuinely different ideas across practical, creative, low-effort, and unconventional approaches. For each, give the concept, why it fits, and one drawback. Rank the strongest three at the end.`,
  },
  {
    id: "improve-offer",
    title: "Improve an offer",
    description:
      "Make an offer clearer by connecting a specific problem to a credible outcome.",
    category: "Business",
    tags: ["offer", "customer", "value"],
    fields: [
      {
        key: "offer",
        label: "What are you offering now?",
        placeholder: "Describe the service or product",
        multiline: true,
      },
      {
        key: "buyer",
        label: "Who is it for?",
        placeholder: "Independent salon owners",
      },
      {
        key: "problem",
        label: "What painful problem does it solve?",
        placeholder: "Too many missed appointments",
      },
    ],
    template: `Improve this offer without inventing proof or guarantees.

Current offer: {{offer}}
Buyer: {{buyer}}
Painful problem: {{problem}}

Return: a one-sentence offer, the concrete outcome, what is included, what remains the buyer’s responsibility, three likely objections, and the smallest credible next step. Flag any claim that needs evidence.`,
  },
];

export const categories = [
  "All",
  "Writing",
  "Decisions",
  "Learning",
  "Research",
  "Analysis",
  "Planning",
  "Ideas",
  "Business",
] as const;
