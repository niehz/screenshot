var ErrorLog = {
  _buffer: [],
  _max: 50,
  report: function(err, ctx) {
    var entry = {
      t: new Date().toISOString(),
      msg: err && err.message ? err.message : String(err),
      stack: err && err.stack ? err.stack : '',
      ctx: ctx || ''
    };
    this._buffer.push(entry);
    if (this._buffer.length > this._max) this._buffer.shift();
    console.error('[ScreenshotPlugin]', entry.msg, entry.ctx || '');
  },
  getLogs: function() { return this._buffer.slice(); },
  clear: function() { this._buffer = []; }
};

function setupGlobalErrorTrap() {
  window.addEventListener('error', function(e) {
    ErrorLog.report(e.error || new Error(e.message), {
      file: e.filename, line: e.lineno, col: e.colno
    });
  });
  window.addEventListener('unhandledrejection', function(e) {
    ErrorLog.report(e.reason, { type: 'unhandledrejection' });
  });
}
