// Source: Milestone 1.pdf supplied by the project owner.
// Durations and wording below preserve the source; details absent from the source stay null.
const induction = Object.freeze({
  name: 'Induction', durationDays: 30,
  learningTopics: ['We learn by doing()', 'AI as a friend', 'You can learn anything', 'Peer learning is the best way to learn better as explaining others helps us understand better', 'Day planning'],
  outcomes: [], prerequisites: null, problemSolvingTrack: 'Number systems / Flowcharts'
});

const phases = Object.freeze([
  induction,
  { name: 'Phase 1', durationDays: 5, learningTopics: ['Student Profile & Course Portal (HTML Only)', 'VS Code + Copilot'], outcomes: ["Project QnA + YT Video's assessed."], prerequisites: ['Induction'], problemSolvingTrack: 'Number systems / Flowcharts' },
  { name: 'Phase 2', durationDays: 13, learningTopics: ['Apply CSS to Phase 1 project'], outcomes: ["Project QnA + YT Video's assessed."], prerequisites: ['Phase 1'], problemSolvingTrack: 'Number systems / Flowcharts' },
  { name: 'Phase 3', durationDays: 20, learningTopics: ['Quiz APP', 'Javascript Basic && DOM'], outcomes: [], prerequisites: ['Flowchart'], problemSolvingTrack: 'DSA Path' },
  { name: 'Phase 4', durationDays: 14, learningTopics: ['AI-Powered Content Generator', 'JavaScript ES6', 'Gemini API Introduction'], outcomes: [], prerequisites: ['Everything until Phase 3'], problemSolvingTrack: 'DSA Path' },
  { name: 'Phase 5', durationDays: 15, learningTopics: ['"Ask Gemini" Web App', 'Node.js & Express.js with Gemini API'], outcomes: [], prerequisites: ['Everything until Phase 4'], problemSolvingTrack: 'DSA Path' },
  { name: 'Phase 6', durationDays: 10, learningTopics: ['Student Feedback Manager', 'Database with MongoDB & Mongoose'], outcomes: [], prerequisites: ['Everything until Phase 5'], problemSolvingTrack: 'DSA Path' },
  { name: 'Phase 7', durationDays: 45, learningTopics: ['React Bootcamp'], outcomes: [], prerequisites: ['Everything until Phase 4'], problemSolvingTrack: null },
  { name: 'Phase 8 Final Open-ended Project', durationDays: 30, learningTopics: ['Paid project / a project to solve an actual social issue around you or something you are passionate about'], outcomes: [], prerequisites: null, problemSolvingTrack: null }
]);

const curriculumContext = Object.freeze({
  problemSolving: '2 hours a day - Solid logic building space facilitated from day 1',
  flowchartsFccBlock: {
    durationDays: 30,
    sourceText: 'Whatever is left of flowcharts + FCC pathway (converting Flowcharts to JS code). We will run 2 experiments here - 1 with the tool and another without; additionally 1 where we do flowcharts +Js and another where w',
    note: 'The source sentence ends mid-word; the remaining experiment details are NOT DEFINED IN MILESTONE 1.'
  },
  sharedProblemSolvingTracks: [
    { track: 'Number systems / Flowcharts', phases: ['Phase 1', 'Phase 2'] },
    { track: 'DSA Path', phases: ['Phase 3', 'Phase 4', 'Phase 5', 'Phase 6'] }
  ]
});

const phaseDurations = Object.freeze(Object.fromEntries(phases.map(({ name, durationDays }) => [name, durationDays])));
const getPhase = (name) => phases.find((phase) => phase.name === name) || null;

module.exports = { phases, induction, curriculumContext, phaseDurations, getPhase, source: 'Milestone 1.pdf' };
