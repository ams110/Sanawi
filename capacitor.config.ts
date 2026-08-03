import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.sanawi.app',
  appName: 'سنوي',
  webDir: 'dist',
  android: {
    // الويب داخل التطبيق يجب أن يبقى بخلفية التطبيق لا بيضاء:
    // الوميض الأبيض عند كل فتح يجعل التطبيق يبدو بطيئاً وهو ليس كذلك.
    backgroundColor: '#FAF8F3',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      backgroundColor: '#FAF8F3',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
  },
}

export default config
