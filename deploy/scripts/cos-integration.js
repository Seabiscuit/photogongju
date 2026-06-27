var COS_ENABLED=process.env.COS_ENABLED==='true',cosClient=null;
if(COS_ENABLED){try{var COS=require('cos-nodejs-sdk-v5');cosClient=new COS({SecretId:process.env.COS_SECRET_ID,SecretKey:process.env.COS_SECRET_KEY});}catch(e){}}
async function uploadToCOS(localPath,cosKey){return new Promise(function(resolve,reject){cosClient.putObject({Bucket:process.env.COS_BUCKET,Region:process.env.COS_REGION,Key:cosKey,Body:require('fs').createReadStream(localPath)},function(err,data){if(err)reject(err);else resolve('https://'+process.env.COS_BUCKET+'.cos.'+process.env.COS_REGION+'.myqcloud.com/'+cosKey);});});}
module.exports={COS_ENABLED,uploadToCOS};
