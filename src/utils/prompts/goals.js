export const GOAL_GUIDANCE = Object.freeze({
  internship: {
    label: 'internship',
    ask: 'Ask whether they know of relevant internship opportunities or would be open to a short conversation. Do not assume they are hiring.'
  },
  referral: {
    label: 'a referral',
    ask: 'Politely ask for advice or a referral for a suitable role at their company, only if they feel comfortable. The sender is seeking help.'
  },
  informational_chat: {
    label: 'an informational chat',
    ask: 'Ask for a brief 15-minute conversation to learn about their work.'
  },
  recruiter_outreach: {
    label: 'recruiter outreach',
    ask: 'The sender is a candidate contacting a recruiter. Ask about suitable openings or the right application path; never write as if the sender is the recruiter.'
  },
  collaboration: {
    label: 'a collaboration',
    ask: 'Ask whether they would be open to a short conversation about a possible collaboration, grounded in the provided evidence.'
  }
});

export function goalGuidance(goal) {
  return GOAL_GUIDANCE[goal] || {
    label: 'a professional conversation',
    ask: 'Ask for a brief conversation and keep the request easy to decline.'
  };
}

export function goalLabel(goal) {
  return goalGuidance(goal).label;
}
