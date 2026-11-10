/* Dalal Street League · stocks players can pick (NSE symbols). `p` is a SAMPLE price used only until the first real price sync. */
(function (root) {
  var U = [
    ['RELIANCE','Reliance Industries','Energy',1290],['TCS','Tata Consultancy Services','IT',3450],['HDFCBANK','HDFC Bank','Banks',1720],['ICICIBANK','ICICI Bank','Banks',1310],['INFY','Infosys','IT',1580],
    ['BHARTIARTL','Bharti Airtel','Telecom',1690],['SBIN','State Bank of India','Banks',820],['ITC','ITC','FMCG',430],['LT','Larsen & Toubro','Infra',3580],['HINDUNILVR','Hindustan Unilever','FMCG',2390],
    ['KOTAKBANK','Kotak Mahindra Bank','Banks',1890],['AXISBANK','Axis Bank','Banks',1140],['BAJFINANCE','Bajaj Finance','Finance',920],['MARUTI','Maruti Suzuki','Auto',12400],['SUNPHARMA','Sun Pharma','Pharma',1760],
    ['HCLTECH','HCL Technologies','IT',1620],['M&M','Mahindra & Mahindra','Auto',3050],['TATAMOTORS','Tata Motors','Auto',700],['NTPC','NTPC','Power',350],['POWERGRID','Power Grid Corporation','Power',300],
    ['TITAN','Titan Company','Consumer',3450],['ULTRACEMCO','UltraTech Cement','Cement',11600],['ASIANPAINT','Asian Paints','Consumer',2400],['WIPRO','Wipro','IT',265],['ONGC','ONGC','Energy',250],
    ['ADANIENT','Adani Enterprises','Diversified',2450],['ADANIPORTS','Adani Ports','Infra',1380],['JSWSTEEL','JSW Steel','Metals',1010],['TATASTEEL','Tata Steel','Metals',160],['COALINDIA','Coal India','Energy',400],
    ['BAJAJFINSV','Bajaj Finserv','Finance',1990],['BAJAJ-AUTO','Bajaj Auto','Auto',8500],['NESTLEIND','Nestle India','FMCG',2350],['TECHM','Tech Mahindra','IT',1600],['HINDALCO','Hindalco','Metals',680],
    ['GRASIM','Grasim Industries','Cement',2700],['CIPLA','Cipla','Pharma',1500],['DRREDDY',"Dr. Reddy's Labs",'Pharma',1250],['EICHERMOT','Eicher Motors','Auto',5400],['HEROMOTOCO','Hero MotoCorp','Auto',4300],
    ['APOLLOHOSP','Apollo Hospitals','Healthcare',7100],['BRITANNIA','Britannia','FMCG',5600],['TATACONSUM','Tata Consumer','FMCG',1100],['INDUSINDBK','IndusInd Bank','Banks',820],['SBILIFE','SBI Life Insurance','Insurance',1780],
    ['HDFCLIFE','HDFC Life Insurance','Insurance',750],['BEL','Bharat Electronics','Defence',380],['TRENT','Trent','Retail',5300],['SHRIRAMFIN','Shriram Finance','Finance',660],['BPCL','BPCL','Energy',320],
    ['DMART','Avenue Supermarts (DMart)','Retail',4200],['HAL','Hindustan Aeronautics','Defence',4700],['DLF','DLF','Realty',780],['PIDILITIND','Pidilite Industries','Consumer',3000],['SIEMENS','Siemens','Capital Goods',3100],
    ['IOC','Indian Oil','Energy',145],['VEDL','Vedanta','Metals',450],['GODREJCP','Godrej Consumer','FMCG',1200],['DABUR','Dabur India','FMCG',510],['HAVELLS','Havells India','Consumer',1550],
    ['ICICIPRULI','ICICI Prudential Life','Insurance',620],['ICICIGI','ICICI Lombard','Insurance',1900],['BANKBARODA','Bank of Baroda','Banks',245],['PNB','Punjab National Bank','Banks',105],['CANBK','Canara Bank','Banks',110],
    ['GAIL','GAIL','Energy',185],['TATAPOWER','Tata Power','Power',395],['ADANIGREEN','Adani Green Energy','Power',1000],['ADANIPOWER','Adani Power','Power',580],['AMBUJACEM','Ambuja Cements','Cement',560],
    ['CHOLAFIN','Cholamandalam Finance','Finance',1550],['TVSMOTOR','TVS Motor','Auto',2800],['INDIGO','InterGlobe Aviation (IndiGo)','Aviation',5500],['LTIM','LTIMindtree','IT',5300],['PFC','Power Finance Corp','Finance',410],
    ['RECLTD','REC','Finance',400],['IRCTC','IRCTC','Travel',770],['IRFC','Indian Railway Finance','Finance',135],['JIOFIN','Jio Financial Services','Finance',320],['VBL','Varun Beverages','FMCG',480],
    ['LUPIN','Lupin','Pharma',2000],['DIVISLAB',"Divi's Laboratories",'Pharma',6200],['TORNTPHARM','Torrent Pharma','Pharma',3300],['ZYDUSLIFE','Zydus Lifesciences','Pharma',950],['MARICO','Marico','FMCG',700],
    ['BOSCHLTD','Bosch','Auto',32000],['ABB','ABB India','Capital Goods',5500],['POLYCAB','Polycab India','Capital Goods',6800],['DIXON','Dixon Technologies','Electronics',15500],['PERSISTENT','Persistent Systems','IT',5600],
    ['MUTHOOTFIN','Muthoot Finance','Finance',2400],['NAUKRI','Info Edge (Naukri)','Internet',1450],['PAYTM','One97 Communications (Paytm)','Internet',950],['NYKAA','FSN E-Commerce (Nykaa)','Internet',200],['POLICYBZR','PB Fintech (Policybazaar)','Internet',1800],
    ['SUZLON','Suzlon Energy','Power',60],['IDEA','Vodafone Idea','Telecom',8],['YESBANK','Yes Bank','Banks',20],['NHPC','NHPC','Power',85],['SAIL','SAIL','Metals',130],
    ['BHEL','BHEL','Capital Goods',250],['IDFCFIRSTB','IDFC First Bank','Banks',72],['FEDERALBNK','Federal Bank','Banks',200],['ASHOKLEY','Ashok Leyland','Auto',135],['MRF','MRF','Auto',135000]
  ].map(function (r) { return { s: r[0], n: r[1], sec: r[2], p: r[3] }; });
  if (typeof module === 'object' && module.exports) module.exports = U; else root.DSL_UNIVERSE = U;
})(typeof self !== 'undefined' ? self : this);
