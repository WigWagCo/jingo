var router = require("express").Router(),
  util = require("util"),
  tools  = require("../lib/tools"),
  path = require("path"),
  renderer = require("../lib/renderer"),
  models = require("../lib/models"),
  corsEnabler = require("../lib/cors-enabler"),
  app = require("../lib/app").getInstance(),
  Promiserr = require("bluebird");

var proxyPath = app.locals.config.getProxyPath();

models.use(Git);

router.get("/", _getIndex);
router.get("/wiki", _getWiki);
router.options("/wiki/:page", corsEnabler);
router.get("/wiki/:page", corsEnabler, _getWikiPage);
router.get("/wiki/:page/history", _getHistory);
router.get("/wiki/:page/:version", _getWikiPage);
router.get("/wiki/:page/compare/:revisions", _getCompare);

function _getHistory(req, res) {

  var page = new models.Page(req.params.page);

  page.fetch().then(function () {

    return page.fetchHistory();
  }).then(function (history) {

    // FIXME better manage an error here
    if (!page.error) {
      console.log("history:",util.inspect(history,{depth:null}))
      res.render("history", {
        items: history,
        title: "History of " + page.name,
        page: page
      });
    }
    else {
      res.locals.title = "404 - Not found";
      res.statusCode = 404;
      res.render("404.jade");
    }
  });
}

function _getWiki(req, res) {

  var items = [];
  var pagen = 0|req.query.page;

  var pages = new models.Pages();

  pages.fetch(pagen).then(function () {

    pages.models.forEach(function (page) {

      if (!page.error) {
        items.push({
          page: page,
          hashes: page.hashes.length == 2 ? page.hashes.join("..") : ""
        });
      }
    });

    res.render("list", {
      items: items,
      title: "All the pages",
      pageNumbers: Array.apply(null, Array(pages.totalPages)).map(function (x, i) {
        return i + 1;
      }),
      pageCurrent: pages.currentPage
    });
  }).catch(function (ex) {
    console.log(ex);
  });
}

// capture: -->[//]: # "PRAGMA CONTENT_STYLE width:150%"<--- on first line only 
var PRAGMA_re = /^\[\/\/\]\:\s+\#\s\"PRAGMA\s+(([^\"\s]*)\s*([^\"]*))\"\s+/g;
var get_page_url_re = /^\/[^\/]+(\/.*)/;

function _getWikiPage(req, res) {

  var page = new models.Page(req.params.page, req.params.version);

  page.fetch().then(function () {

    if (!page.error) {

      res.locals.canEdit = true;
      if (page.revision !== "HEAD" && page.revision != page.hashes[0]) {
        res.locals.warning = "You're not reading the latest revision of this page, which is " + "<a href='" + page.urlForShow() + "'>here</a>.";
        res.locals.canEdit = false;
      }

      res.locals.notice = req.session.notice;
      delete req.session.notice;

      var CONTENT_STYLE = "";
      var TOC_HTML = null;
      var doPreRender = function() {        
        var proms = [];
        var m = PRAGMA_re.exec(page.content);
        while(m) {
          console.log("see PRAGMA:",m[1]);
          if(m && m.length > 1) {
            if(m[2] == 'CONTENT_STYLE') {
              console.log("CONTENT_STYLE:",m[3]);
              CONTENT_STYLE = m[3];
            }
            if(m[2] == 'TOC') {
              var page_url = null;
              var m2 = get_page_url_re.exec(req.url);
              if(m2 && m2.length > 0) {
                page_url = m2[1];
              } else {
                console.error("ERROR: Page has TOC, but URL is not a page?");
              }

              // also, see if a TOC exists - if so grab it.
              var toc = new models.TOC(m[3],page_url);
              proms.push(
                toc.fetch().then(function(ret){
                  console.log("Model TOC is: -->",util.inspect(ret,{depth:null}));
                  console.log("<--")
                  TOC_HTML = renderer.makeTOCHTML(ret,page_url)
                  console.log("HTML TOC is: -->",TOC_HTML);
                  console.log("<--")

                })
              );
            }
          }
          m = PRAGMA_re.exec(page.content);
        }        
        return Promiserr.all(proms); // wait for any deferred, then fulfill
      }

      var _collabs = null;

      doPreRender()
      .then(function(){
        return page.fetchHistory().then(function(history){
          // we only want the contributors, not all of the history:
          var list = {};
          for(var z=0;z<history.length;z++) {
            list[history[z].email] = {
              author: history[z].author,
              email: history[z].email,
            }
          }
          var collabs = [];
          var keyz = Object.keys(list);
          for(var z=0;z<keyz.length;z++) {
            collabs.push(list[keyz[z]]);
          }
          _collabs = collabs;
        });
      })
      .then(function(){
        res.render("show", {
          page: page,
          title: app.locals.config.get("application").title + " – " + page.title,
          content: renderer.render("# " + page.title + "\n" + page.content),
          CONTENT_STYLE: CONTENT_STYLE,
          TOC_HTML: TOC_HTML,
          collabs: _collabs
        });
      }).catch(function(e){
        console.error("@catch doPreRender:",e);
      });
    }
    else {

      if (req.user) {

        // Try sorting out redirect loops with case insentive fs
        // Path 'xxxxx.md' exists on disk, but not in 'HEAD'.
        if (/but not in 'HEAD'/.test(page.error)) {
          page.setNames(page.name.slice(0,1).toUpperCase() + page.name.slice(1));
        }
        res.redirect(page.urlFor("new"));
      }
      else {

        // Special case for the index page, anonymous user and an empty docbase
        if (page.isIndex()) {
          res.render("welcome", {
            title: "Welcome to " + app.locals.config.get("application").title
          });
        }
        else {
          res.locals.title = "404 - Not found";
          res.statusCode = 404;
          res.render("404.jade");
          return;
        }
      }
    }
  });
}

function _getCompare(req, res) {

  var revisions = req.params.revisions;

  var page = new models.Page(req.params.page);

  page.fetch().then(function () {

    return page.fetchRevisionsDiff(req.params.revisions);
  }).then(function (diff) {
    if (!page.error) {

      var lines = [];
      diff.split("\n").slice(4).forEach(function (line) {

        if (line.slice(0,1) != "\\") {
          lines.push({
            text: line,
            ldln: leftDiffLineNumber(0, line),
            rdln: rightDiffLineNumber(0, line),
            className: lineClass(line)
          });
        }
      });

      var revs = req.params.revisions.split("..");
      res.render("compare", {
        page: page,
        lines: lines,
        title: "Revisions compare",
        revs: revs
      });

    }
    else {
      res.locals.title = "404 - Not found";
      res.statusCode = 404;
      res.render("404.jade");
      return;
    }
  });

  var ldln = 0,
    cdln;

  function leftDiffLineNumber(id, line) {

    var li;

    switch (true) {

      case line.slice(0,2) == "@@":
        li = line.match(/\-(\d+)/)[1];
        ldln = parseInt(li, 10);
        cdln = ldln;
        return "...";

      case line.slice(0,1) == "+":
        return "";

      case line.slice(0,1) == "-":
      default:
        ldln++;
        cdln = ldln - 1;
        return cdln;
    }
  }

  var rdln = 0;
  function rightDiffLineNumber(id, line) {

    var ri;

    switch (true) {

      case line.slice(0,2) == "@@":
        ri = line.match(/\+(\d+)/)[1];
        rdln = parseInt(ri, 10);
        cdln = rdln;
        return "...";

      case line.slice(0,1) == "-":
        return " ";

      case line.slice(0,1) == "+":
      default:
        rdln += 1;
        cdln = rdln - 1;
        return cdln;
    }
  }

  function lineClass(line) {
    if (line.slice(0,2) === "@@") {
      return "gc";
    }
    if (line.slice(0,1) === "-") {
      return "gd";
    }
    if (line.slice(0,1) === "+") {
      return "gi";
    }
  }
}

function _getIndex(req, res) {
  res.redirect(proxyPath + "/wiki/" + app.locals.config.get("pages").index);
}

module.exports = router;
