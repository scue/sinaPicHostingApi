const axios = require('axios')
const sinaSSOEncoder = require('./sinaSSOEncoder.js')
const querystring = require('querystring')
const axiosCookieJarSupport = require('node-axios-cookiejar')
const tough = require('tough-cookie')
const FileCookieStore = require("tough-cookie-filestore")
const fs = require('fs')
const request = require('request')
const readline = require('readline')
const config = require('./config.json')
const username = config.auth.username
const password = config.auth.password
axiosCookieJarSupport(axios);
const cookieJar = new tough.CookieJar(new FileCookieStore("./cookie.json"));
/**
 * [get some necessary info for login]
 */
async function preLogin(){ 
	let preLoginUrl = 'http://login.sina.com.cn/sso/prelogin.php?entry=weibo&callback=sinaSSOController.preloginCallBack&su=MTUyNTUxMjY3OTY%3D&rsakt=mod&checkpin=1&client=ssologin.js%28v1.4.18%29&_=1458836718537'
	let preLoginResp = await axios.get(preLoginUrl)
	let preContentRegex = /\((.*?)\)/g
	console.log(`preLoginResponse: ${preLoginResp.data}`);
    let patten = preContentRegex.exec(preLoginResp.data)
    let {pcid, nonce, pubkey, servertime, rsakv} = JSON.parse(patten[1])
    return {pcid, nonce, pubkey, servertime, rsakv}
}
function inputPinCode(pinCodePath) {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});

	return new Promise((resolve, reject) => {
		rl.question(`请输入验证码，验证码图片在${pinCodePath}\n`, pinCode => {
			console.log(`你输入的验证码为：${pinCode}`);
			rl.close();
			resolve(pinCode);
		});
	});
}
/**
 * [login and save cookie to file]
 * @param  {[String]} username {weibo account username}
 * @param  {[String]} password {weibo account password }
 */
async function login(username,password){
	let RSAKey = new sinaSSOEncoder.RSAKey();
	let {pcid, nonce, pubkey, servertime, rsakv} = await preLogin()
	RSAKey.setPublic(pubkey, "10001");
  	passwd = RSAKey.encrypt([servertime, nonce].join("\t") + "\n" + password)
  	username = new Buffer(encodeURIComponent(username)).toString('base64')
  	data = {
  		'entry': 'weibo',
        'gateway': '1',
        'from': '',
        'savestate': '7',
        'useticket': '1',
        'pagerefer': 'http://weibo.com/p/1005052679342531/home?from=page_100505&mod=TAB&pids=plc_main',
        'vsnf': '1',
        'su': username,
        'service': 'miniblog',
        'servertime': servertime,
        'nonce': nonce,
        'pwencode': 'rsa2',
        'rsakv': rsakv,
        'sp': passwd,
        'sr': '1366*768',
        'encoding': 'UTF-8',
        'prelt': '115',
        'url': 'http://weibo.com/ajaxlogin.php?framelogin=1&callback=parent.sinaSSOController.feedBackUrlCallBack',
        'returntype': 'META'
	  }
	if (pcid) {
		let pinImgUrl = `http://login.sina.com.cn/cgi/pin.php?r=${Math.floor(Math.random() * 1e8)}&s=0&p=${pcid}`;
		let pinCodePath = `/tmp/pinCode.png`
		request(pinImgUrl).pipe(fs.createWriteStream(pinCodePath));
		let pinCode = await inputPinCode(pinCodePath)
		data['door'] = pinCode;
		data['pcid'] = pcid;
	}
	console.log(`post data: ${JSON.stringify(data, "", " ")}`);
  	url = 'http://login.sina.com.cn/sso/login.php?client=ssologin.js(v1.4.18)'
	let loginResp = await axios.post(url, querystring.stringify(data),{
		jar: cookieJar,
		headers: {
			'User-Agent':'Mozilla/5.0 (Windows NT 6.3; WOW64; rv:41.0) Gecko/20100101 Firefox/41.0',
		}
	})
	let reg = /location\.replace\((?:"|')(.*)(?:"|')\)/;
	let loginUrl = reg.exec(loginResp.data)[1];
	console.log(`logingUrl:`, loginUrl);
	await axios.get(loginUrl,{
		jar: cookieJar,
		withCredentials: true,
		headers: {
			'User-Agent':'Mozilla/5.0 (Windows NT 6.3; WOW64; rv:41.0) Gecko/20100101 Firefox/41.0',
		}
	})
}	
/**
 * @param  {[String]} file {picture path}
 * @return {[String]} {picture pid}
 */
async function getImgUrl(file){
	var errTime = 0
	try{
		let bitmap = fs.readFileSync(file)
		let base64Img = new Buffer(bitmap).toString('base64')
		let imageUrl = 'http://picupload.service.weibo.com/interface/pic_upload.php?mime=image%2Fjpeg&data=base64&url=0&markpos=1&logo=&nick=0&marks=1&app=miniblog'
		let upImgResp = await axios.post(imageUrl, querystring.stringify({b64_data:base64Img}),{
			jar: cookieJar,
			withCredentials: true,
			headers: {
				'User-Agent':'Mozilla/5.0 (Windows NT 6.3; WOW64; rv:41.0) Gecko/20100101 Firefox/41.0',
			}
		})
		let {data} = JSON.parse(upImgResp.data.replace(/([\s\S]*)<\/script>/g,''))
		imgUrl = data['pics']['pic_1']['pid']
		if (imgUrl) {
			return imgUrl
		} else {
			throw 'no img url '
		}
	}
	catch(e){ 
		errTime+=1
		// console.log('发生错误，重新登录中。。。')
		if (errTime>5) { //retry time when upload fail
			errTime = 0
			return false
		}
		return login(username, password)
			.then(() => {
				return getImgUrl(file);
			})
			.catch(e => {
				console.warn(e);
			});
	}
}
module.exports = getImgUrl