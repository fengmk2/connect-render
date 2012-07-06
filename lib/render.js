/*!
 * connect-render
 * Copyright(c) 2012 fengmk2 <fengmk2@gmail.com>
 * MIT Licensed
 */

/**
 * Module dependencies.
 */

var fs = require('fs');
var path = require('path');
var http = require('http');
var ejs = require('ejs');

var settings = {
  root: __dirname + '/views',
  cache: true,
  layout: 'layout.html'
};

var cache = {};

function _render_tpl(fn, options, callback) {
  var str;
  try {
    str = fn.call(options.scope, options);
  } catch (err) {
    return callback(err);
  }
  callback(null, str);
}

var reg_meta = /[\\\^$*+?{}.()|\[\]]/g;
var open = ejs.open || "<%";
var close = ejs.close || "%>";
var PARTIAL_PATTERN_RE = new RegExp(open.replace(reg_meta, "\\$&") +
  "[-=]\\s*partial\\((.+)\\)\\s*" + close.replace(reg_meta, "\\$&"), 'g');
/**
 * add support for <%- partial('view') %> function
 * rather than realtime compiling, this implemention simply statically 'include' the partial view file
 * 
 * @param {String} data
 * @param {String} [viewname] view name for partial loop check.
 * @return {String}
 */
function partial(data, viewname) {
  return data.replace(PARTIAL_PATTERN_RE, function (all, view) {
    view = view.match(/['"](.*)['"]/);    // get the view name
    if (!view || view[1] === viewname) {
      return "";
    } else {
      var viewpath = path.join(settings.root, view[1]);
      var tpl = '';
      try {
        tpl = fs.readFileSync(viewpath, 'utf8');
      } catch (e) {
        console.error("[%s][connect-render] Error: cannot load view partial %s\n%s", new Date(), viewpath, e.stack);
        return "";
      }
      return partial(tpl, view[1]);
    }
  });
}

function _render(view, options, callback) {
  var viewpath = path.join(settings.root, view);
  var fn = settings.cache && cache[view];
  if (fn) {
    return _render_tpl(fn, options, callback);
  }
  // read template data from view file
  fs.readFile(viewpath, 'utf8', function (err, data) {
    if (err) {
      return callback(err);
    }
    var tpl = partial(data);
    fn = ejs.compile(tpl, {filename: view});
    if (settings.cache) {
      cache[view] = fn;
    }
    _render_tpl(fn, options, callback);
  });
}

/**
 * Render the view fill with options
 * 
 * @param  {String} view    view name.
 * @param  {Object} [options=null]
 */
function render(view, options) {
  var self = this;
  options = options || {};
  if (settings.helpers) {
    for (var k in settings.helpers) {
      var helper = settings.helpers[k];
      if (typeof helper === 'function') {
        helper = helper(self.req, self);
      }
      options[k] = helper;
    }
  }
  // add request to options
  if (!options.request) {
    options.request = self.req;
  }
  // render view template
  _render(view, options, function (err, str) {
    if (err) {
      return self.req.next(err);
    }
    var layout = typeof options.layout === 'string' ? options.layout : settings.layout;
    if (options.layout === false || !layout) {
      var buf = new Buffer(str);
      self.setHeader('Content-Length', buf.length);
      return self.end(buf);
    }
    // render layout template, add view str to layout's locals.body;
    options.body = str;
    _render(layout, options, function (err, str) {
      if (err) {
        return self.req.next(err);
      }
      var buf = new Buffer(str);
      self.setHeader('Content-Length', buf.length);
      self.end(buf);
    });
  });
  return this;
}

/**
 * connect-render: Template Render helper for connect
 * 
 * Use case:
 * 
 * var render = require('./lib/render');
 * var connect = require('connect');
 * 
 * connect(
 *   render({
 *     root: __dirname + '/views',
 *     cache: true, // must set `true` in production env
 *     layout: 'layout.html', // or false for no layout
 *     helpers: {
 *       config: config,
 *       sitename: 'NodeBlog Engine',
 *       _csrf: function (req, res) {
 *         return req.session ? req.session._csrf : "";
 *       },
 *     }
 *   });
 * );
 * 
 * res.render('index.html', { title: 'Index Page', items: items });
 * 
 * // no layout 
 * res.render('blue.html', { items: items, layout: false });
 * 
 * @param {Object} [options={}] render options.
 * @return {Function} render middleware for `connect`
 */
module.exports = function (options) {
  options = options || {};
  for (var k in options) {
    settings[k] = options[k];
  }
  return function (req, res, next) {
    req.next = next;
    if (!res.req) {
      res.req = req;
    }
    res.render = render;
    next();
  };
};