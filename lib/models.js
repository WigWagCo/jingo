var Promiserr = require("bluebird"),
  path = require("path"),
  util = require("util"),
  namer = require("./namer"),
  app = require("./app"),
  fs = require("fs"),
  Configurable = require("./configurable"),
  locker = require("./locker");

var gitmech;

var ON_log_dbg = function() {
    var args = Array.prototype.slice.call(arguments);
    args.unshift("[models]");
    console.log.apply(console,args);
};

var log_dbg = function() {}

log_dbg = ON_log_dbg; // uncomment for debug

var Configuration = function () {
  Configurable.call(this);
}

Configuration.prototype = Object.create(Configurable.prototype);

var configuration = new Configuration();

function Page(name, revision) {
  name = name || "";
  this.setNames(name);
  this.revision = revision || "HEAD";
  this.content = "";
  this.title = "";
  this.metadata = {};
  this.error = "";
  this.author = "";
  this.lockedBy = null;
  this.hashes = [];
  this.lastCommand = "";
  this.lastCommitMessage = "";
  Configurable.call(this);
}

Page.prototype = Object.create(Configurable.prototype);

Page.prototype.setNames = function (name) {
  this.name = namer.unwikify(name.replace(/\.md$/, ""));
  this.wikiname = namer.wikify(this.name);
  this.filename = this.wikiname + ".md";
  this.pathname = gitmech.absPath(this.filename);
};

Page.prototype.remove = function () {

  return new Promiserr(function (resolve, reject) {

    if (this.error) {
      resolve();
      return;
    }
    gitmech.rm(this.filename, "Page removed (" + this.wikiname + ")", this.author, function (err) {
      resolve();
    });
  }.bind(this));
};

Page.prototype.renameTo = function (newName) {

  var newFilename = newName + ".md";

  return new Promiserr(function (resolve, reject) {

    // Cannot rename if the file already exists
    if (fs.existsSync(gitmech.absPath(newFilename))) {
      reject();
      return;
    }

    gitmech.mv(this.filename,
               newFilename,
               "Page renamed (" + this.filename + " => " + newFilename + ")",
               this.author,
               function (err) {
                 if (err) {
                   reject();
                 }
                 else {
                   this.setNames(newName);
                   resolve();
                 }
               }.bind(this));
  }.bind(this));
};

Page.prototype.exists = function () {
  return fs.existsSync(this.pathname);
};

Page.prototype.save = function (message) {

  message = message || "";

  return new Promiserr(function (resolve, reject) {

    if (this.error) {
      resolve();
      return;
    }

    var defMessage = (this.exists() ? "Content updated" : "Page created") + " (" + this.wikiname + ")";

    message = (message.trim() === "") ? defMessage : message.trim();

    var content = this.content;

    if (this.getConfig().pages.title.fromContent) {
      content = "# " + this.title + "\n" + content;
    }

    content = content.replace(/\r\n/gm, "\n");

    fs.writeFile(this.pathname, content, function (err) {

      if (err) {
        reject(err);
        return;
      }

      gitmech.add(this.filename, message, this.author, function (err) {

        if (err) {
          reject(err);
          return;
        }

        resolve(content);
      }.bind(this));
    }.bind(this));
  }.bind(this));
};

Page.prototype.urlFor = function (action) {

  return Page.urlFor(this.wikiname, action, this.getProxyPath());
};

Page.urlFor = function (name, action, proxyPath) {

  var wname = encodeURIComponent(name);
  proxyPath = proxyPath || "";

  var url = "";

  switch (true) {

    case action == "show":
      url = "/wiki/" + wname;
      break;

    case action == "edit":
      url = "/pages/" + wname + "/edit";
      break;

    case action == "edit error":
      url = "/pages/" + wname + "/edit?e=1";
      break;

    case action == "edit put":
      url = "/pages/" + wname;
      break;

    case action == "revert":
      url = "/pages/" + wname + "/revert";
      break;

    case action == "history":
      url = "/wiki/" + wname + "/history";
      break;

    case action == "compare":
      url = "/wiki/" + wname + "/compare";
      break;

    case action == "new":
      url = "/pages/new/" + wname;
      break;

    case action == "new error":
      url = "/pages/new/" + wname + "?e=1";
      break;

    default:
      url = "/";
      break;
  }

  return proxyPath + url;
};


Page.prototype.urlForShow = function (action) {
  return this.urlFor("show");
};

Page.prototype.urlForEdit = function (action) {
  return this.urlFor("edit");
};

Page.prototype.urlForEditWithError = function (action) {
  return this.urlFor("edit error");
};

Page.prototype.urlForNewWithError = function (action) {
  return this.urlFor("new error");
};

Page.prototype.urlForEditPut = function (action) {
  return this.urlFor("edit put");
};

Page.prototype.urlForRevert = function (action) {
  return this.urlFor("revert");
};

Page.prototype.urlForHistory = function (action) {
  return this.urlFor("history");
};

Page.prototype.urlForCompare = function (action) {
  return this.urlFor("compare");
};

Page.prototype.isIndex = function () {
  return this.getConfig().pages.index == this.name;
};

Page.prototype.isFooter = function () {
  return this.name == "_footer";
};

Page.prototype.isSidebar = function () {
  return this.name == "_sidebar";
};

Page.prototype.lock = function (user) {

  var lock = locker.getLock(this.name);

  if (lock && lock.user.asGitAuthor != user.asGitAuthor) {
    this.lockedBy = lock.user;
    return false;
  }

  locker.lock(this.name, user);
  this.lockedBy = user;
  return true;
};

Page.prototype.unlock = function (user) {
  this.lockedBy = null;
  locker.unlock(this.name);
};

Page.prototype.fetch = function (extended) {

  if (!extended) {
    return Promiserr.all([this.fetchContent(),
                        this.fetchMetadata(),
                        this.fetchHashes(1)
                        ]);
  }
  else {
    return Promiserr.all([this.fetchContent(),
                        this.fetchMetadata(),
                        this.fetchHashes(),
                        this.fetchLastCommitMessage()]);
  }
};

Page.prototype.fetchContent = function () {

  return new Promiserr(function (resolve, reject) {

    if (this.error) {
      resolve();
      return;
    }

    gitmech.show(this.filename, this.revision, function (err, content) {

      this.lastCommand = "show";

      content = content || "";

      if (err) {
        this.error = err;
      }
      else {

        this.rawContent = content;

        if (content.length === 0 || this.getConfig().pages.title.fromFilename) {
          this.title = this.name;
          this.content = content;
        }
        else {
          // Retrieves the title from the first line of the content (and removes it from the actual content)
          // By default Jingo (< 1.0) stores the title as the first line of the
          // document, prefixed by a '#'
          var lines = content.split("\n");
          this.title = lines[0].trim();

          if (this.title.charAt(0) == "#") {
            this.title = this.title.substr(1).trim();
            this.content = lines.slice(1).join("\n");
          }
          else {
            // Mmmmh... this file doesn't seem to follow Jingo's convention...
            this.title = this.name;
            this.content = content;
          }
        }
      }

      resolve();
    }.bind(this));
  }.bind(this));
};

Page.prototype.fetchMetadata = function () {

  return new Promiserr(function (resolve, reject) {

    if (this.error) {
      resolve();
      return;
    }

    gitmech.log(this.filename, this.revision, function (err, metadata) {

      this.lastCommand = "log";

      if (err) {
        this.error = err;
      }
      else {

        if (typeof metadata != "undefined") {
          this.metadata = metadata;
        }
      }

      resolve();
    }.bind(this));
  }.bind(this));
};

Page.prototype.fetchHashes = function (howmany) {

  howmany = howmany || 2;

  return new Promiserr(function (resolve, reject) {

    if (this.error) {
      resolve();
      return;
    }

    gitmech.hashes(this.filename, howmany, function (err, hashes) {

      this.lastCommand = "hashes";

      if (err) {
        this.error = err;
      }
      else {
        this.hashes = hashes;
      }

      resolve();
    }.bind(this));
  }.bind(this));
};

Page.prototype.fetchLastCommitMessage = function () {

  return new Promiserr(function (resolve, reject) {

    if (this.error) {
      resolve();
      return;
    }

    gitmech.lastMessage(this.filename, "HEAD", function (err, message) {

      this.lastCommand = "lastMessage";

      if (err) {
        this.error = err;
      }
      else {
        this.lastCommitMessage = message;
      }

      resolve();
    }.bind(this));
  }.bind(this));
};

Page.prototype.fetchHistory = function () {

  return new Promiserr(function (resolve, reject) {

    if (this.error) {
      resolve();
      return;
    }

    gitmech.log(this.filename, "HEAD", 30, function (err, history) {

      this.lastCommand = "log";

      if (err) {
        this.error = err;
      }

      resolve(history);

    }.bind(this));
  }.bind(this));
};

Page.prototype.fetchRevisionsDiff = function (revisions) {

  return new Promiserr(function (resolve, reject) {

    if (this.error) {
      resolve();
      return;
    }

    gitmech.diff(this.filename, revisions, function (err, diff) {

      if (err) {
        this.error = err;
      }

      resolve(diff);

    }.bind(this));
  }.bind(this));
};

Page.prototype.revert = function () {

  return new Promiserr(function (resolve, reject) {

    if (this.error) {
      resolve();
      return;
    }

    if ("HEAD" === this.revision) {
      reject();
      return;
    }

    gitmech.revert(this.filename, this.revision, this.author, function (err, data) {
      if (err) {
        this.error = err;
        reject(err);
        return;
      }
      resolve(data);
    }.bind(this));
  }.bind(this));
};

function Pages() {
  this.models = [];
  this.total = 0;
  Configurable.call(this);
}

Pages.prototype = Object.create(Configurable.prototype);

Pages.prototype.fetch = function (pagen) {

  return new Promiserr(function (resolve, reject) {

    gitmech.ls("*.md", function (err, list) {

      var model, Promisers = [];

      if (err) {
        reject(err);
        return;
      }

      var itemsPerPage = this.getConfig().pages.itemsPerPage;

      this.total = list.length;
      this.totalPages = Math.ceil(this.total / itemsPerPage);

      if (pagen <= 0) {
        pagen = 1;
      }
      if (pagen > this.totalPages) {
        pagen = this.totalPages;
      }

      this.currentPage = pagen;

      // Read the stats from the fs to be able to sort the whole
      // list before slicing the page out
      var listWithData = list.map(function (page) {

        var stats;

        try {
          stats = fs.statSync(gitmech.absPath(page));
        }
        catch (e) {
          stats = null;
        }
        return {
          name: page,
          stats: stats
        };
      });

      listWithData.sort(function (a, b) {
        return (a.stats !== null && b.stats !== null) ? b.stats.mtime.getTime() - a.stats.mtime.getTime() : 0;
      });

      var offset = (pagen - 1) * itemsPerPage;
      var slice = listWithData.slice(offset, offset + itemsPerPage);

      slice.forEach(function (data) {
        var page = path.basename(data.name).replace(/\.md$/,"");
        model = new Page(page);
        this.models.push(model);
        Promisers.push(model.fetch(true));
      }.bind(this));

      Promiserr.all(Promisers).then(resolve);
    }.bind(this));
  }.bind(this));
};

// this is the key for a map of all URLs to TOC, 
// for reverse indexing, to remove a page if it comes out of the TOC
// { '/wiki/BLAH': 'SOME-TOC:subcategory:BLAH', 
// ...
// }
var BY_URL_TOC_INDEX = '##masterURLTOCIndex';

// a Table of Content object
// TOC is created by the user when they use a: [//]: # "PRAGMA TOC Tutorial:Step 1"
function TOC(toc_path,url) {
  if(typeof url !== 'string') {
    throw new Error("Bad parameters for TOC object init.");
  }
  log_dbg("new TOC model:",arguments);
  this.toc_path = toc_path;
  if(toc_path) {
    this.toc_pieces = toc_path.split(':');
    this.name = this.toc_pieces[0];
  }
  this.url = url;
  this.app = app.getInstance();
  Configurable.call(this);
}

TOC.prototype = Object.create(Configurable.prototype);

TOC.prototype.lookupViaIndex = function() {
  var self = this;
  return new Promiserr(function (resolve, reject) {
    self.app.jingoMetadataDB.findOne({_id:BY_URL_TOC_INDEX},function(err,doc){
      if(!doc) {
        log_dbg("NOTE: No existing TOC index found.");
        reject();
      } else {
        if(doc[self.url]) {
          self.toc_path = doc[self.url];
          log_dbg("lookup, found TOC:",self.toc_path);
          if(self.toc_path) {
            self.toc_pieces = self.toc_path.split(':');
            self.name = self.toc_pieces[0];
          }
        }
        if(self.toc_path) resolve()
          else reject();
      }
    });
  });
}

TOC.prototype._updateTOCIndex = function(toc_path,url) {
  var self = this;
  return new Promiserr(function(resolve,reject){
    var createIndex = function() {
      var index = {};
      index._id = BY_URL_TOC_INDEX;
      index[url] = toc_path;
      self.app.jingoMetadataDB.insert(index,function(err){
        if(err) {
          reject(err);
        } else {
          resolve();          
        }
      });
    }

    var updateIndex = function() {
      var set_this = {};
      set_this[url] = toc_path;
      log_dbg("set_this:",set_this);
      self.app.jingoMetadataDB.update({_id:BY_URL_TOC_INDEX},{ $set: set_this }, {}, function(err){
        if(err) {
          reject(err);
        } else {
          log_dbg("TOC index updated.");
          resolve();
        }
      });
    }

    self.app.jingoMetadataDB.findOne({_id:BY_URL_TOC_INDEX},function(err,doc){
      if(!doc) {
        log_dbg("NOTE: No existing TOC index found, creating a new one.");
        createIndex();;
      } else {
        updateIndex(doc);
      }
    });
  });
}

// leaf = { name: 'my name' }

TOC.prototype._makeNewTOC = function(toc_path) {
  var self = this;
  log_dbg("_makeNewTOC");
  return new Promiserr(function (resolve, reject) {
    var toc_pieces = toc_path.split(':');
    if(toc_pieces.length > 0 && toc_pieces[0].length > 0) {
      var template_toc = {
        name: toc_pieces[0],
        html: null,
        leafs: {
        // 'some entry' : { name: 'some entry', 
        //   html: '<b>optional html stuff</b>',
        //   pageURL: /wiki/some-entry, 
        //   leafs: { // resurse here
        //   } 
        // }
        }  // all the peices for here
      };
      

      var walk = template_toc.leafs;
      for(var n=1;n<toc_pieces.length;n++) {
        var splits = toc_pieces[n].split('%');
        var url = namer.wikify(splits[0]);
        if(n == toc_pieces.length - 1) 
          url = self.url;
        walk[splits[0]] = {
          name: splits[0],
          pageURL: path.join('/wiki/',url), // FIXME
          leafs: {},
          html: splits[1]
        }
        walk = walk[splits[0]].leafs;
      }
      template_toc._id = template_toc.name;
      log_dbg("ok, write:", template_toc);
      self.app.jingoMetadataDB.insert(template_toc,function(err){
        if(err) {
          reject(err)
        } else {
          log_dbg("wrote new TOC successful:",template_toc);
          resolve(template_toc);
        }
      })
    }
  });
}

TOC.prototype.fetch = function() {
  var self = this;

  return new Promiserr(function (resolve, reject) {
    self.app.whenMetadataDbReady(function(){
      // look up by the TOC name
      log_dbg("Looking up TOC:",self.name);
      self.app.jingoMetadataDB.find({name:self.name}, function(err,docs) {
        if(err) {
          reject(err);
        } else {
          if(docs.length > 0) {
            log_dbg("Got TOC object:",docs[0]);
            resolve(docs[0]);
          } else {
            // was not in the DB, create it and update.
            self._makeNewTOC(self.toc_path).then(function(doc){
              resolve(doc);
            },function(err){
              console.error("Could not make new TOC:",err);
              reject(err);
            });
          }
        }         
      });
    })
  });
};




TOC.prototype.update = function(opts) {
  var self = this;
  var toc_path = this.toc_path;
  var removeme = false;
  if(opts && opts.remove) {
      removeme = true;
  }
  return new Promiserr(function (resolve, reject) {
      var toc_pieces = toc_path.split(':');
      if(toc_pieces.length > 0 && toc_pieces[0].length > 0) {
        self.app.whenMetadataDbReady(function(){
          self.app.jingoMetadataDB.find({name:toc_pieces[0]}, function(err,docs) {
            if(err) {
              reject(err);
            } else {
              log_dbg("find result:",docs);
              // walk path, and make sure each part is handled.
              if(docs.length < 1) {
                self._makeNewTOC(toc_path).then(function(){
                  resolve();
                });
                return;
              } else {
                // add to existing TOC
                var root = docs[0];
                var walk = docs[0].leafs;
                log_dbg("leafs walk",walk);
                for(var n=1;n<toc_pieces.length;n++) {
                  var splits = toc_pieces[n].split('%');
                  if(!walk[toc_pieces[n]]) {
                      // if leaf not there, make it
                      var url = namer.wikify(splits[0]);
                      if(n == toc_pieces.length - 1) 
                        url = self.url;
                      if(!removeme) {
                        walk[splits[0]] = {
                          name: splits[0],
                          pageURL: path.join('/wiki',url),
                          leafs: {},
                          html: splits[1]
                        }                        
                      }
                  } else if(removeme) {
                    if(n == toc_pieces.length-1) { // if this is a leaf entry (no children)
                      log_dbg("removing entry:",toc_pieces[n],"in TOC",toc_pieces[0]);
                      delete walk[splits[0]];  // delete the entry.
                      break;
                    }
                  }
                  // move down leaf
                  walk = walk[splits[0]].leafs;
                }
              }
              self._updateTOCIndex(self.toc_path,self.url);
              log_dbg("modified TOC",toc_pieces[0],"saving:",util.inspect(root));   
              self.app.jingoMetadataDB.update({name:toc_pieces[0]},root,{},function(err,numReplaced){
                log_dbg("modified TOC written",arguments);
                resolve();
              });
            }
          });
        });        
      } else {
        reject(new Error("bad TOC name"));
      }  
  });
};


var models = {

  Page: Page,

  Pages: Pages,
  TOC: TOC,

  use: function (git) {
    gitmech = git;
  },

  repositories: {

    refresh: function (callback) {

      gitmech.pull(function (err) {
        callback(err);
      });
    }
  },

  pages: {

    findString: function (string, callback) {

      gitmech.grep(string, function (err, items) {

        callback(err, items);
      });
    },
  }
};

Promiserr.promisifyAll(models.pages);
Promiserr.promisifyAll(models.repositories);

module.exports = models;
