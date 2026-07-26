/**
 * Express Async Handler
 * Wraps async functions to catch errors and pass them to the next middleware.
 * Eliminates the need for manual try-catch blocks in every controller.
 */
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
