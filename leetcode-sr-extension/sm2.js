// sm2.js - SM-2 Spaced Repetition Algorithm

/**
 * SM-2 Algorithm
 * @param {number} quality - 0-5 (5=perfect, 3=correct with effort, 1=wrong)
 * @param {number} repetitions - how many times reviewed
 * @param {number} easeFactor - current ease factor (default 2.5)
 * @param {number} interval - current interval in days
 * @returns {{ interval, repetitions, easeFactor, nextReview }}
 */
function sm2(quality, repetitions, easeFactor, interval) {
  if (quality < 3) {
    // Failed - reset
    repetitions = 0;
    interval = 1;
  } else {
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * easeFactor);
    }
    repetitions += 1;
  }

  easeFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  if (easeFactor < 1.3) easeFactor = 1.3;

  const nextReview = Date.now() + interval * 24 * 60 * 60 * 1000;

  return { interval, repetitions, easeFactor, nextReview };
}

/**
 * Initialize a problem from /progress history
 * @param {string} problemId
 * @param {string} title
 * @param {string} difficulty
 * @param {number} lastAcTimestamp - unix ms
 * @param {number} submissionCount - total submissions (used to infer initial quality)
 * @param {string} slug
 */
function initProblem(problemId, title, difficulty, lastAcTimestamp, submissionCount, slug) {
  // Infer initial quality from submission count
  let initialQuality;
  if (submissionCount <= 2) initialQuality = 5;
  else if (submissionCount <= 5) initialQuality = 4;
  else if (submissionCount <= 10) initialQuality = 3;
  else initialQuality = 2;

  // Days since last AC
  const daysSince = Math.max(1, Math.floor((Date.now() - lastAcTimestamp) / (24 * 60 * 60 * 1000)));

  // Start with default SM-2 values, but set nextReview based on history
  const result = sm2(initialQuality, 0, 2.5, 1);

  // If it's been a long time, it's overdue — schedule it soon
  const overdueBonus = Math.min(daysSince, 30); // cap at 30
  result.nextReview = Date.now() + Math.max(0, (result.interval - overdueBonus)) * 24 * 60 * 60 * 1000;

  return {
    id: problemId,
    title,
    difficulty,
    slug,
    submissionCount,
    lastAcTimestamp,
    repetitions: result.repetitions,
    easeFactor: result.easeFactor,
    interval: result.interval,
    nextReview: result.nextReview,
    initialized: true,
  };
}

/**
 * Apply a review rating to a problem
 * @param {object} problem - existing problem record
 * @param {number} quality - 1 (hard), 3 (ok), 5 (easy)
 */
function applyReview(problem, quality) {
  const result = sm2(quality, problem.repetitions, problem.easeFactor, problem.interval);
  return {
    ...problem,
    repetitions: result.repetitions,
    easeFactor: result.easeFactor,
    interval: result.interval,
    nextReview: result.nextReview,
    lastReviewed: Date.now(),
  };
}

/**
 * Get today's review list
 * @param {object} allProblems - { [id]: problem }
 * @param {number} limit - max problems
 * @returns {array} sorted list of due problems
 */
function getTodayList(allProblems, limit = 10) {
  const now = Date.now();
  const due = Object.values(allProblems).filter(p => p.nextReview <= now);

  // Sort: most overdue first, then by difficulty (Hard > Med > Easy)
  const difficultyWeight = { Hard: 3, Medium: 2, Med.: 2, Easy: 1 };
  due.sort((a, b) => {
    const overdueA = now - a.nextReview;
    const overdueB = now - b.nextReview;
    if (Math.abs(overdueA - overdueB) > 7 * 24 * 60 * 60 * 1000) {
      return overdueB - overdueA; // more overdue first
    }
    return (difficultyWeight[b.difficulty] || 1) - (difficultyWeight[a.difficulty] || 1);
  });

  return due.slice(0, limit);
}
