var Marked = require("marked"),
  cryptoz = require("crypto"),
  Nsh    = require("node-syntaxhighlighter"),
  namer  = require("./namer"),
  Page = require("./models").Page,
  directives   = require("./directives"),
  Configurable = require("./configurable");

var Configuration = function () {
  Configurable.call(this);
}

Configuration.prototype = Object.create(Configurable.prototype);

var configuration = new Configuration();

var mdRenderer = new Marked.Renderer();

mdRenderer.table = function(header, body) {
  return '<table class="sortable">\n'
    + '<thead>\n'
    + header
    + '</thead>\n'
    + '<tbody>\n'
    + body
    + '</tbody>\n'
    + '</table>\n';
};

mdRenderer.code = function (code, lang, escaped) {

  if (this.options.highlight) {
    var out = this.options.highlight(code, lang);
    if (out !== null && out !== code) {
      escaped = true;
      code = out;
    }
  }

  if (!lang) {
    return "<code class=\"md-code\">" +
           (escaped ? code : escape(code, true)) +
           "\n</code>";
  }

  return "<code class=\"md-code "
    + this.options.langPrefix
    + escape(lang, true)
    + "\">"
    + (escaped ? code : escape(code, true))
    + "\n</code>\n";
};

Marked.setOptions({
  gfm: true,
  renderer: mdRenderer,
  // pedantic: this is set on the render method
  // breaks: this is set on the render method
  tables: true,
  smartLists: true,
  sanitize: false, // To be able to add iframes
  highlight: function (code, lang) {
    lang = lang || "text";
    return Nsh.highlight(code, Nsh.getLanguage(lang) || Nsh.getLanguage("text"), {gutter: lang !== "text"});
  }
});

var tagmap = {};

// Yields the content with the rendered [[bracket tags]]
// The rules are the same for Gollum https://github.com/github/gollum
function extractTags(text) {

  tagmap = {};

  var matches = text.match(/(.?)\[\[(.+?)\]\]/g),
    tag,
    id;

  if (matches) {
    matches.forEach(function (match) {
      match = match.trim();
      tag = /(.?)\[\[(.+?)\]\](.?)/.exec(match);
      if (tag[1] == "'") {
        return;
      }
      id = cryptoz.createHash("sha1").update(tag[2]).digest("hex");
      tagmap[id] = tag[2];
      text = text.replace(tag[0], id);
    });

  }
  return text;
}

function evalTags(text) {

  var parts,
    name,
    url,
    pageName,
    re;
  
  for (var k in tagmap) {
    if (tagmap.hasOwnProperty(k)) {
      parts = tagmap[k].split("|");
      name = pageName = parts[0];
      if (parts[1]) {
        pageName = parts[1];
      }
      url = Page.urlFor(namer.wikify(pageName), "show", configuration.configObject.getProxyPath());

      tagmap[k] = "<a class=\"internal\" href=\"" + url + "\">" + name + "</a>";
    }
  }

  for (k in tagmap) {
    if (tagmap.hasOwnProperty(k)) {
      re = new RegExp(k, "g");
      text = text.replace(re, tagmap[k]);
    }
  }

  return text;
}

var directiveMap = directives.directiveMap;

function applyDirectives(text) {
  var matches = text.match(/\{\{([^}]*)\}\}/g);

  if (matches) {
    matches.forEach(function (match) {
      var directiveString = /\{\{([^}]*)\}\}/.exec(match)[1];
      var directiveSplit = directiveString.split("\n");
      var directive = directiveSplit[0];
      var args = directiveSplit.slice(1).join("\n");
      if (directive in directiveMap) {
        text = text.replace(match, directiveMap[directive](text, args));
      }
    });
  }
  return text;
}

var Renderer = {

  render: function (content) {

    Marked.setOptions({
      pedantic: configuration.getConfig().application.pedanticMarkdown,
      breaks: configuration.getConfig().application.gfmBreaks
    });

    var text = extractTags(content);
    text = evalTags(text);
    text = applyDirectives(text);
    return Marked(text);
  },

  /**
   * @param  {Object} obj A TOC object from the models.js definition
   * @return {[type]}     [description]
   */
  makeTOCHTML: function(obj,currentURL) {
    var html = "";
    var myURL = '/wiki'+currentURL;
    console.log("currentURL:",currentURL,myURL);
    var html_leafs = function(leafs,expanderid) {
      html+='<ul>';
      var kyz = Object.keys(leafs);
      for(var n=0;n<kyz.length;n++) {
        html+='<li>';
        var has_leafs = false;
        var kyz2 = Object.keys(leafs[kyz[n]].leafs);
        if(kyz2.length > 0) {
          has_leafs = true;
          html+='<input type="checkbox" id="'+expanderid+'-'+n+'">';
          html+='<label for="'+expanderid+'-'+n+'"';
          if(myURL == leafs[kyz[n]].pageURL) html+=' class="onThisPage"';
          html+='>'; // 
          if(leafs[kyz[n]].pageURL) {
            html+='<a href="'+leafs[kyz[n]].pageURL+'">';
            if(leafs[kyz[n]].html) 
              html+=leafs[kyz[n]].html;
            else
              html+=leafs[kyz[n]].name;
            html+='</a></label>';
          } else {
            html+='<span>';
            if(leafs[kyz[n]].html) 
              html+=leafs[kyz[n]].html;
            else
              html+=leafs[kyz[n]].name;
            html+='</span></label>';
          }
          html_leafs(leafs[kyz[n]].leafs,expanderid+'-'+n);
        } else {
          if(leafs[kyz[n]].pageURL) {
            html+='<a href="'+leafs[kyz[n]].pageURL+'"';
            if(myURL == leafs[kyz[n]].pageURL) html+=' class="onThisPage"';
            html+='>'; // 
            if(leafs[kyz[n]].html) 
              html+=leafs[kyz[n]].html;
            else
              html+=leafs[kyz[n]].name;
            html+='</a>';                                            
          } else {
            html+='<span';
            if(myURL == leafs[kyz[n]].pageURL) html+=' class="onThisPage"';
            html+='>'; // 
            if(leafs[kyz[n]].html) 
              html+=leafs[kyz[n]].html;
            else
              html+=leafs[kyz[n]].name;
            html+='</span>';                                
          }
        }
        html+='</li>'
      }
      html+='</ul>';
    }

    if(obj.html) {
      html += '<h2 class="toc">' + obj.html + '</h2>'
    } else {
      html += '<h2 class="toc">' + obj.name + '</h2>'
    }
    html+='<div class="toc_treeview hover">'
    html_leafs(obj.leafs,'cb');
    html+='</div>'    
    return html;
  }


};

module.exports = Renderer;
