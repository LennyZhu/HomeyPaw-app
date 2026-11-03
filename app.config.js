// Store profiles pin separate build numbers; local development uses app.json.
module.exports = ({ config }) => {
  const target = process.env.EXPO_PUBLIC_HOMEYPAW_BUILD_TARGET;
  const number = process.env.HOMEYPAW_IOS_BUILD_NUMBER;
  const store = target === 'billing-rc-sandbox' || target === 'production';
  if (store && !/^[1-9]\d*$/.test(number ?? '')) {
    throw new Error('STORE_IOS_BUILD_NUMBER_REQUIRED');
  }
  return {
    ...config,
    ios: {
      ...config.ios,
      buildNumber: store ? number : config.ios.buildNumber,
    },
  };
};
