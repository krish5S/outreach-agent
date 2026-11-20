export function buildResumeStructuringPrompt(sections) {
  return [
    'Convert the supplied, already-sanitized resume sections into the requested JSON shape.',
    'Use only facts present in the supplied sections. Never invent employers, schools, dates, titles, skills, achievements, goals, or interests.',
    'Do not produce a person name, email, phone number, street address, or contact/location field.',
    'Keep each item concise while preserving exact factual details. Use empty strings or empty arrays when the source does not say.',
    'Return these fields only: headline, summary, skills, education, experience, projects, achievements, goals, interests.',
    'education items: {school, degree, field, years}.',
    'experience items: {title, org, years, highlights}.',
    'project items: {name, summary, tech}.',
    'skills, achievements, and interests are arrays of strings. goals is a string.',
    'Resume sections JSON:',
    JSON.stringify(sections)
  ].join('\n');
}
