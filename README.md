## Bower Static Resource CDN

### Get started

1. npm i
1. link *cdn* folder in your working directory to you web server. This folder will created when publishing component.  If not, you could manually create one.
e.g.:

```
    ln -sf  ${pwd}/cdn  /Library/WebServer/Documents  ## Apache Root on my localhost  
```


### CLI Configurations
* -v verbose logging
* -o offline when running bower install. used for development only.
* -r resolve mode. Writing version resolve to system output. //TODO: version resolution is not implemented yet.
* -s server mode. An Express server will be started to act as a dependency bundler
* default without -o -s publish mode

**-v could be used with -o or -s or solely which is default to publish mode**


### CLI Publish
```
./index.js  sal-components-gmb#1.0.9  -v
```

### CLI Resolve
```
./index.js  sal-components-gmb#1.0.9  -rv
```

### Run Web Serve

```
./index.js -sv

"OR

export port=8086 CDN_PREFIX=http://im.yourcdn.com/;  npm start
```

### Publish
If you pass in multiple versions of same library, The last one will win always.

```
http://localhost:8086/p/lodash:3.10.1,seajs:3.0.0,toastr:2.1.1,jquery:1.11.1,jquery:2.1.4
```


### Unpublish
If you pass in multiple versions of same library, The last one will win always.

```
http://localhost:8086/unp/lodash:3.10.1,seajs:3.0.0,toastr:2.1.1,jquery:1.11.1,jquery:2.1.4
```

### Browser Query
If you pass in multiple versions of same library, The last one will win always.

```
http://localhost:8086/q/backbone:1.2.3,foundation:5.5.2,bootstrap:3.3.5,d3:3.3.5,jquery:1.11.1/iamacoolid/shim/jquery:1.11.1,d3:3.3.3
```

