(() => {
  const SITE_URL = 'https://vasuki8.github.io/us-treasury-holder-tracker/';

  window.treasuryBillingConfig = Object.freeze({
    version:'2026-09-15',
    currency:'USD',
    siteUrl:SITE_URL,
    plans:Object.freeze({
      proMonthly:Object.freeze({id:'treasury-pro-monthly',price:15,cadence:'month'}),
      proAnnual:Object.freeze({id:'treasury-pro-annual',price:150,cadence:'year'}),
      apiMonthly:Object.freeze({id:'treasury-api-monthly',price:99,cadence:'month'}),
    }),
    checkout:Object.freeze({
      proMonthly:'',
      proAnnual:'',
      api:'',
    }),
    redirects:Object.freeze({
      success:`${SITE_URL}checkout-success.html`,
      cancel:`${SITE_URL}checkout-cancelled.html`,
    }),
    legal:Object.freeze({
      terms:`${SITE_URL}terms.html`,
      privacy:`${SITE_URL}privacy.html`,
      refunds:`${SITE_URL}refunds.html`,
    }),
    supportUrl:'https://github.com/Vasuki8/us-treasury-holder-tracker/issues',
  });
})();
