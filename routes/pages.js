var router = require("express").Router(),
  namer  = require("../lib/namer"),
  app    = require("../lib/app").getInstance(),
  models = require("../lib/models"),
  components = require("../lib/components");

var Busboy = require('busboy');
var path = require('path');

models.use(Git);

router.get("/pages/new", _getPagesNew);
router.get("/pages/new/:page", _getPagesNew);
router.get("/pages/:page/edit", _getPagesEdit);
router.post("/pages", _postPages);
router.put("/pages/:page", _putPages);
router.delete("/pages/:page", _deletePages);
router.get("/pages/:page/revert/:version", _getRevert);
router.post("/upload-img", _postImage);

var pagesConfig = app.locals.config.get("pages");
var proxyPath = app.locals.config.getProxyPath();

var ON_log_dbg = function() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[pages]");
    console.log.apply(console,args);
};

var log_dbg = function() {}

log_dbg = ON_log_dbg; // uncomment for debug


function _deletePages(req, res) {
  var get_page_url_re = /^\/[^\/]+(\/.*)/;
  var page = new models.Page(req.params.page);
  var m = get_page_url_re.exec(req.url);

  if (page.isIndex() || !page.exists()) {
    req.session.notice = "The page cannot be deleted.";
    res.redirect(proxyPath + "/");
    return;
  }

  page.author = req.user.asGitAuthor;

  page.remove().then(function () {

    // remove from TOC, if it has an entry
    if(m && m.length > 1) {
      var toc = new models.TOC(null,m[1]);
      toc.lookupViaIndex().then(function(){
        console.log("Was in TOC, removing");
        toc.update({remove:true});
      },function(){});
    }

    page.unlock();

    if (page.isFooter()) {
      app.locals._footer = null;
    }

    if (page.isSidebar()) {
      app.locals._sidebar = null;
    }

    req.session.notice = "The page `" + page.wikiname + "` has been deleted.";
    res.redirect(proxyPath + "/");
  });
}

function _getPagesNew(req, res) {

  var page, title = "";

  if (req.params.page) {
    // This is not perfect, unfortunately
    title = namer.unwikify(req.params.page);
    page = new models.Page(title);
    if (page.exists()) {
      res.redirect(page.urlForShow());
      return;
    }
  }

  res.locals.errors = req.session.errors;
  res.locals.formData = req.session.formData || {};
  delete req.session.errors;
  delete req.session.formData;

  res.render("create", {
    title: "Jingo – Create page " + title,
    pageTitle: title,
    pageName: page ? page.wikiname : ""
  });
}

function _postImage(req, res) {


  var busboy = new Busboy({ headers: req.headers, limits: {
                                                    fileSize: app.locals.config.get("pages").maxImageSize
              } 
  });

  log_dbg("got _postImage",req.headers);
  
  var fname = "???";

  var limited = [];

  busboy.on('file', function(fieldname, file, filename, encoding, mimetype) {
    file.on('limit',function(){
      limited.push(filename);
    });

    log_dbg('got image file', filename, mimetype, encoding);

    var usename = path.basename(filename);
    var img = new models.Image(usename);
    img.author = req.user.asGitAuthor;

    img.savePipeable(file).then(function(ret){
      log_dbg("ok, wrote file",ret);
      fname = ret;      
        
      if(limited.length) {
        res.json({
          filename: "ERROR ON UPLOAD - TOO LARGE"
        });
        img.cleanup();
      } else {
        img.commit().then(function(final_name){
          res.json({
            filename: path.join('/wiki/',final_name)
          });
        })
      }


    });
    // var writeStream = gfs.createWriteStream({
    //   _id: fileId,
    //   filename: filename,
    //   mode: 'w',
    //   content_type: mimetype,
    // });
    // file.pipe(writeStream);
  }).on('finish', function() {
    log_dbg("got 'finish'");
    // show a link to the uploaded file
    // res.writeHead(200, {'content-type': 'text/html'});
    // res.end('<a href="/file/' + fileId.toString() + '">download file</a>');
  });

  log_dbg("pipe to busboy");
  req.pipe(busboy);

  log_dbg("temp end of _postImage");
  return;






  var errors,
    pageName;

  if (pagesConfig.title.fromFilename) {
    // pageName (from url) is not considered
    pageName = req.body.pageTitle;
  }
  else {
    // pageName (from url) is more important
    pageName = (namer.unwikify(req.body.pageName) || req.body.pageTitle);
  }

  var page = new models.Page(pageName);

  req.check("pageTitle", "The page title cannot be empty").notEmpty();
  req.check("content",   "The page content cannot be empty").notEmpty();

  errors = req.validationErrors();

  if (errors) {
    req.session.errors = errors;
    // If the req.body is too big, the cookie session-store will crash,
    // logging out the user. For this reason we use the sessionStorage
    // on the client to save the body when submitting
    //    req.session.formData = req.body;
    req.session.formData = {
      pageTitle: req.body.pageTitle
    };
    res.redirect(page.urlForNewWithError());
    return;
  }

  req.sanitize("pageTitle").trim();
  req.sanitize("content").trim();

  if (page.exists()) {
    req.session.errors = [{msg: "A document with this title already exists"}];
    res.redirect(page.urlFor("new"));
    return;
  }

  page.author = req.user.asGitAuthor;
  page.title = req.body.pageTitle;
  page.content = req.body.content;

  page.save().then(function () {
    req.session.notice = "The page has been created. <a href=\"" + page.urlForEdit() + "\">Edit it again?</a>";
    res.redirect(page.urlForShow());
  }).catch(function (err) {
    res.locals.title = "500 - Internal server error";
    res.statusCode = 500;
    console.log(err);
    res.render("500.jade", {
      message: "Sorry, something went wrong and I cannot recover. If you think this might be a bug in Jingo, please file a detailed report about what you were doing here: https://github.com/claudioc/jingo/issues . Thank you!",
      error: err
    });
  });
}


function _postPages(req, res) {

  var errors,
    pageName;

  if (pagesConfig.title.fromFilename) {
    // pageName (from url) is not considered
    pageName = req.body.pageTitle;
  }
  else {
    // pageName (from url) is more important
    pageName = (namer.unwikify(req.body.pageName) || req.body.pageTitle);
  }

  var page = new models.Page(pageName);

  req.check("pageTitle", "The page title cannot be empty").notEmpty();
  req.check("content",   "The page content cannot be empty").notEmpty();

  errors = req.validationErrors();

  if (errors) {
    req.session.errors = errors;
    // If the req.body is too big, the cookie session-store will crash,
    // logging out the user. For this reason we use the sessionStorage
    // on the client to save the body when submitting
    //    req.session.formData = req.body;
    req.session.formData = {
      pageTitle: req.body.pageTitle
    };
    res.redirect(page.urlForNewWithError());
    return;
  }

  req.sanitize("pageTitle").trim();
  req.sanitize("content").trim();

  if (page.exists()) {
    req.session.errors = [{msg: "A document with this title already exists"}];
    res.redirect(page.urlFor("new"));
    return;
  }

  page.author = req.user.asGitAuthor;
  page.title = req.body.pageTitle;
  page.content = req.body.content;

  page.save().then(function () {
    req.session.notice = "The page has been created. <a href=\"" + page.urlForEdit() + "\">Edit it again?</a>";
    res.redirect(page.urlForShow());
  }).catch(function (err) {
    res.locals.title = "500 - Internal server error";
    res.statusCode = 500;
    console.log(err);
    res.render("500.jade", {
      message: "Sorry, something went wrong and I cannot recover. If you think this might be a bug in Jingo, please file a detailed report about what you were doing here: https://github.com/claudioc/jingo/issues . Thank you!",
      error: err
    });
  });
}

function _putPages(req, res) {

  var errors,
    page;

  page = new models.Page(req.params.page);

  req.check("pageTitle", "The page title cannot be empty").notEmpty();
  req.check("content",   "The page content cannot be empty").notEmpty();

  errors = req.validationErrors();

  if (errors) {
    fixErrors();
    return;
  }

  // Highly unluckly (someone deleted the page we were editing)
  if (!page.exists()) {
    req.session.notice = "The page does not exist anymore.";
    res.redirect(proxyPath + "/");
    return;
  }

  req.sanitize("pageTitle").trim();
  req.sanitize("content").trim();
  req.sanitize("message").trim();

  page.author = req.user.asGitAuthor;

  // Test if the user changed the name of the page and try to rename the file
  // If the title is from filename, we cannot overwrite an existing filename
  // If the title is from content, we never rename a file and the problem does not exist
  if (app.locals.config.get("pages").title.fromFilename &&
      page.name.toLowerCase() != req.body.pageTitle.toLowerCase()) {
    page.renameTo(req.body.pageTitle)
          .then(savePage)
          .catch(function (ex) {
            errors = [{
              param: "pageTitle",
              msg: "A page with this name already exists.",
              value: ""
            }];
            fixErrors();
          });
  }
  else {
    savePage();
  }

// TOC pragma: [//]: # "PRAGMA TOC Tutorial:Step 1:sub step 1"
var TOC_PRAGMA_re = /^\s*\[\/\/\]\:\s+\#\s\"PRAGMA\s+TOC\s+([^\"\s]*\s*[^\"]*)\"\s+/m;

var get_page_url_re = /^\/[^\/]+(\/.*)/;

  function savePage()  {
    page.title = req.body.pageTitle;
    page.content = req.body.content;

    var originalURL = req.url;
//    log_dbg("originalURL",req);
    page.save(req.body.message).then(function () {
      var m = TOC_PRAGMA_re.exec(page.content,originalURL);
      var m2 = get_page_url_re.exec(originalURL);
      if(m && m.length > 1 && m2) {
        log_dbg("Got TOC:",m[1],'for URL',m2[1]);
        var toc = new models.TOC(m[1],m2[1]);
        toc.update();
      }

      page.unlock();

      if (page.name == "_footer") {
        components.expire("footer");
      }

      if (page.name == "_sidebar") {
        components.expire("sidebar");
      }

      req.session.notice = "The page has been updated. <a href=\"" + page.urlForEdit() + "\">Edit it again?</a>";
      res.redirect(page.urlForShow());

    }).catch(function (err) {
      res.locals.title = "500 - Internal server error";
      res.statusCode = 500;
      console.log(err);
      res.render("500.jade", {
        message: "Sorry, something went wrong and I cannot recover. If you think this might be a bug in Jingo, please file a detailed report about what you were doing here: https://github.com/claudioc/jingo/issues . Thank you!",
        error: err
      });
    });
  }

  function fixErrors() {
    req.session.errors = errors;
    // If the req.body is too big, the cookie session-store will crash,
    // logging out the user. For this reason we use the sessionStorage
    // on the client to save the body when submitting
    //    req.session.formData = req.body;
    req.session.formData = {
      pageTitle: req.body.pageTitle,
      message: req.body.message
    };
    res.redirect(page.urlForEditWithError());
  }
}

function _getPagesEdit(req, res) {

  var page = new models.Page(req.params.page),
    warning;

  if (!page.lock(req.user)) {
    warning = "Warning: this page is probably being edited by " + page.lockedBy.displayName;
  }

  models.repositories.refreshAsync().then(function () {

    return page.fetch();
  }).then(function () {

    if (!req.session.formData) {

      res.locals.formData = {
        pageTitle: page.title,
        content: page.content
      };
    }
    else {

      res.locals.formData = req.session.formData;
      // FIXME remove this when the sessionStorage fallback will be implemented
      if (!res.locals.formData.content) {
        res.locals.formData.content = page.content;
      }
    }

    res.locals.errors = req.session.errors;

    delete req.session.errors;
    delete req.session.formData;

    res.render("edit", {
      title: "Jingo – Edit page " + page.title,
      page: page,
      warning: warning
    });
  });
}

function _getRevert(req, res) {

  var page = new models.Page(req.params.page, req.params.version);

  page.author = req.user.asGitAuthor;

  page.fetch().then(function () {
    if (!page.error) {
      page.revert();
      res.redirect(page.urlFor("history"));
    }
    else {
      res.locals.title = "500 - Internal Server Error";
      res.statusCode = 500;
      res.render("500.jade");
      return;
    }
  });
}

module.exports = router;
