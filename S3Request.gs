/* constructs an S3Request to an S3 service
 *
 * @constructor
 * @param {S3} service S3 service to which this request will be sent
 */
function S3Request(service) {
  this.service = service;

  this.httpMethod = "PUT";
  this.contentType = "";
  this.content = ""; //content of the HTTP request
  this.bucket = ""; //gets turned into host (bucketName.s3.amazonaws.com)
  this.objectName = "";
  this.headers = {};
  this.region = "";
  
  this.date = new Date();
}

/* sets contenetType of the request
 * @param {string} contentType mime-type, based on RFC, indicated how content is encoded
 * @throws {string} message if invalid input
 * @return {S3Request} this request, for chaining
 */
S3Request.prototype.setContentType = function (contentType) {
  if (typeof contentType != 'string') throw 'contentType must be passed as a string';
  this.contentType = contentType;
  return this;
};

S3Request.prototype.getContentType = function () {
  if (this.contentType) {
    return this.contentType; 
  } else {
    //if no contentType has been explicitly set, default based on HTTP methods
    if (this.httpMethod == "PUT" || this.httpMethod == "POST") {
      //UrlFetchApp defaults to this for these HTTP methods
      return "application/x-www-form-urlencoded"; 
    }
  }
  return "";
}


/* sets content of request
 * @param {string} content request content encoded as a string
 * @throws {string} message if invalid input
 * @return {S3Request} this request, for chaining
 */ 
S3Request.prototype.setContent = function(content) {
  if (typeof content != 'string') throw 'content must be passed as a string'
  this.content = content; 
  return this;
};

/* sets AWS Region for request
 * @param {string} region AWS Region for request
 * @throws {string} message if invalid input
 * @return {S3Request} this request, for chaining
 */
S3Request.prototype.setRegion = function(region) {
  if (typeof region != 'string') throw "AWS Region must be string";
  this.region = region; 
  return this;
};

/* sets Http method for request
 * @param {string} method http method for request
 * @throws {string} message if invalid input
 * @return {S3Request} this request, for chaining
 */
S3Request.prototype.setHttpMethod = function(method) {
  if (typeof method != 'string') throw "http method must be string";
  this.httpMethod = method; 
  return this;
};

/* sets bucket name for the request
 * @param {string} bucket name of bucket on which request operates
 * @throws {string} message if invalid input
 * @return {S3Request} this request, for chaining
 */
S3Request.prototype.setBucket = function(bucket) {
  if (typeof bucket != 'string') throw "bucket name must be string";
  this.bucket = bucket;
  return this;
};
/* sets objectName (key) for request
 * @param {string} objectName name that uniquely identifies object within bucket
 * @throws {string} message if invalid input
 * @return {S3Request} this request, for chaining
 */
S3Request.prototype.setObjectName = function(objectName) {
  if (typeof objectName != 'string') throw "objectName must be string";
  this.objectName = objectName; 
  return this;
};


/* adds HTTP header to S3 request (see AWS S3 REST api documentation for possible values)
 * 
 * @param {string} name Header name
 * @param {string} value Header value
 * @throws {string} message if invalid input
 * @return {S3Request} this object, for chaining
 */
S3Request.prototype.addHeader = function(name, value) {
  if (typeof name != 'string') throw "header name must be string";
  if (typeof value != 'string') throw "header value must be string";
  this.headers[name] = value; 
  return this;
};

/* gets Url for S3 request 
 * @return {string} url to which request will be sent
 */
S3Request.prototype.getUrl = function() {
  return "https://" + this.bucket.toLowerCase() + ".s3.amazonaws.com/" + this.objectName;
};
/* executes the S3 request and returns HttpResponse
 *
 * Supported options:
 *   logRequests - log requests (and responses) will be logged to Apps Script's Logger. default false.
 *   echoRequestToUrl - also send the request to this URL (useful for debugging Apps Script weirdness)   
 *
 * @param {Object} options object with properties corresponding to option values; see documentation
 * @throws {Object} AwsError on failure
 * @returns {goog.UrlFetchApp.HttpResponse} 
 */
S3Request.prototype.execute = function(options) {
  options = options || {};
  this.headers.Authorization = this.getAuthHeader_();
  this.headers['x-amz-content-sha256'] = this.getHexSha256_(this.content);
  this.headers['x-amz-date'] = this.date.toISOString().replace(/-/g, "").replace(/:/g, "").replace(/\.\d+/g, "");
  
  var params = {
    method: this.httpMethod,
    payload: this.content,
    headers: this.headers,
    muteHttpExceptions: true //get error content in the response
  }

  //only add a ContentType header if non-empty (although should be OK either way)
  if (this.getContentType()) {
    params.contentType = this.getContentType();
  }
  
  var response = UrlFetchApp.fetch(this.getUrl(), params);


  
  //debugging stuff
  var request = UrlFetchApp.getRequest(this.getUrl(), params);  


  //Log request and response
  this.lastExchangeLog = this.service.logExchange_(request, response);
  if (options.logRequests) {
    Logger.log(this.service.getLastExchangeLog());
  }
  
  //used in case you want to peak at the actual raw HTTP request coming out of Google's UrlFetchApp infrastructure
  if (options.echoRequestToUrl) {
    UrlFetchApp.fetch(options.echoRequestToUrl, params); 
  }
  
  //check for error codes (AWS uses variants of 200s for flavors of success)
  if (response.getResponseCode() > 299) {
    //convert XML error response from AWS into JS object, and give it a name
    var error = {};
    error.name = "AwsError";
    try {
      var errorXmlElements = XmlService.parse(response.getContentText()).getRootElement().getChildren();
    
      for (i in errorXmlElements) {
        var name = errorXmlElements[i].getName(); 
        name = name.charAt(0).toLowerCase() + name.slice(1);
        error[name] = errorXmlElements[i].getText();
      }
      error.toString = function() { return "AWS Error - "+this.code+": "+this.message; }; 
     
      error.httpRequestLog = this.service.getLastExchangeLog();
    } catch (e) {
      //error parsing XML error response from AWS (will obscure actual error)
 
      error.message = "AWS returned HTTP code " + response.getResponseCode() + ", but error content could not be parsed."
      
      error.toString = function () { return this.message; };
      
      error.httpRequestLog = this.service.getLastExchangeLog();
    }
    
    throw error;
  }
  
  return response;
};


/* computes Authorization Header value for S3 request
 * reference http://docs.aws.amazon.com/AmazonS3/latest/dev/RESTAuthentication.html
 *
 * @private
 * @return {string} base64 encoded HMAC-SHA1 signature of request (see AWS Rest auth docs for details)
 */
S3Request.prototype.getAuthHeader_ = function () {
  var dateString = this.date.toISOString().replace(/-/g, "").split("T")[0];
  var dateTimeString = this.date.toISOString().replace(/-/g, "").replace(/:/g, "").replace(/\.\d+/g, "");

  var canonicalRequest = this.httpMethod + "\n";

  var canonicalizedResource = this.getUrl().replace("https://"+this.bucket.toLowerCase()+".s3.amazonaws.com","");
  canonicalRequest += canonicalizedResource + "\n\n";

  var amzHeaders = [
    'host:' + this.bucket + '.s3.amazonaws.com',
    'x-amz-content-sha256:' + this.getHexSha256_(this.content),
    'x-amz-date:' + dateTimeString
  ];
  canonicalRequest += amzHeaders.sort().join("\n") + "\n\n";

  canonicalRequest += "host;x-amz-content-sha256;x-amz-date" + "\n";

  canonicalRequest += this.getHexSha256_(this.content);

  var stringToSign = "AWS4-HMAC-SHA256\n" +
       dateTimeString + "\n" +
      dateString + "/" + this.region + "/s3/aws4_request\n" +
      this.getHexSha256_(canonicalRequest);

  var dateKey              = Utilities.computeHmacSha256Signature(dateString, "AWS4"+ this.service.secretAccessKey);
  var dateRegionKey        = Utilities.computeHmacSha256Signature(Utilities.newBlob(this.region).getBytes(), dateKey);
  var dateRegionServiceKey = Utilities.computeHmacSha256Signature(Utilities.newBlob("s3").getBytes(), dateRegionKey);

  var signingKey           = Utilities.computeHmacSha256Signature(Utilities.newBlob("aws4_request").getBytes(), dateRegionServiceKey);
  
  var signature = Utilities.computeHmacSha256Signature(Utilities.newBlob(stringToSign).getBytes(), signingKey);
  signature = signature.map(function(e) {return ("0" + (e < 0 ? e + 256 : e).toString(16)).slice(-2)}).join("");

  var finalHeader =  "AWS4-HMAC-SHA256 " + 
  "Credential=" + this.service.accessKeyId + "/" + dateString + "/" + this.region + "/s3/aws4_request," +
  "SignedHeaders=host;x-amz-content-sha256;x-amz-date," +
  "Signature=" + signature;

  return finalHeader;
};

S3Request.prototype.getHexSha256_ = function(value) {
  var byteSignature = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value);
  var signature = byteSignature.reduce(function(str,chr){
    chr = (chr < 0 ? chr + 256 : chr).toString(16);
    return str + (chr.length==1?'0':'') + chr;
  },'');
  return signature;
}

S3Request.prototype.getHexHmacSha256Signature = function(message, secret) {
  var byteSignature = Utilities.computeHmacSha256Signature(message, secret);
  // convert byte array to hex string
  var signature = byteSignature.reduce(function(str,chr){
    chr = (chr < 0 ? chr + 256 : chr).toString(16);
    return str + (chr.length==1?'0':'') + chr;
  },'');
  return signature;
}

/* calculates Md5 for the content (http request body) of the S3 request
 *   (Content-MD5 on S3 is recommended, not required; so can change this to return "" if it's causing problems - likely due to charset mismatches)
 * 
 * @private
 * @return {string} base64 encoded MD5 hash of content
 */
S3Request.prototype.getContentMd5_ = function() {
  if (this.content.length > 0) {
    return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, this.content, Utilities.Charset.UTF_8));
  } else {
    return ""; 
  }
};
