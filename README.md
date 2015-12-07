## Intro
[![Build Status](https://travis-ci.org/pwang2/brower.svg?branch=master)](https://travis-ci.org/pwang2/brower)

Bower workflow in your browser. This project is still under active development. 

### Get started

1. npm i
1. link *cdn* folder in your working directory to you web server. This folder will created when publishing component.  If not, you could manually create one.
e.g.:

```
    ln -sf  $(pwd)/cdn  /Library/WebServer/Documents  ## Apache Root on my localhost  
```


### CLI Configurations
* -v verbose logging
* -o offline when running bower install. used for development only.
* -r resolve mode. Writing version resolve to system output. 
* -s server mode. An Express server will be started to act as a dependency bundler
* default without -o -s publish mode

**-v could be used with -o or -s or solely which is default to publish mode**


### CLI Publish

```
./index.js  foundation#5.5.2  -v
```

### CLI Resolve
```
./index.js  jquery#1.11.1 foundation#5.5.2  -rv  --shim  jquery#1.11.1
```

### Run Web Serve

```
./index.js -sv

"OR

export port=8086 CDN_PREFIX=http://im.yourcdn.com/;  npm start
```

### Web Publish

```
http://localhost:8086/p/lodash:3.10.1,seajs:3.0.0,toastr:2.1.1,jquery:1.11.1,jquery:2.1.4
```

### Web Unpublish

```
http://localhost:8086/unp/lodash:3.10.1,seajs:3.0.0,toastr:2.1.1,jquery:1.11.1,jquery:2.1.4
```

### Web Query

```
http://localhost:8086/q/backbone:1.2.3,foundation:5.5.2,bootstrap:3.3.5,d3:3.3.5,jquery:1.11.1/shim/jquery:1.11.1,d3:3.3.3?id=ID_YOU_LIKE
```
*in Query mode, ~ is supported*

### JSONP?
Yes! pass querystring &callback=cbname

### Others

* enforce loading order
http://localhost:8868/q/angular-cookies:1.3.5,jquery-ui:1.11.4?overwrite={%22angular%22:%22jquery%22}

### Run Test
`npm test`

(For Windows, please run `npm run wintest`)

