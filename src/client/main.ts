import { createApp } from 'vue';
import { Dialog, Loading, Notify, Quasar, TouchHold } from 'quasar';
import iconSet from 'quasar/icon-set/material-icons-round';
import '@quasar/extras/material-icons-round/material-icons-round.css';
import 'quasar/dist/quasar.css';
import App from './App.vue';
import './styles.css';

createApp(App)
  .use(Quasar, {
    iconSet,
    directives: { TouchHold },
    plugins: { Dialog, Loading, Notify },
    config: {
      brand: {
        primary: '#1554e8',
        secondary: '#008d77',
        accent: '#6c5ce7',
        dark: '#101826',
        positive: '#138a55',
        negative: '#c73545',
        info: '#1769c2',
        warning: '#9a6700',
      },
      notify: {
        position: 'bottom-right',
        timeout: 3500,
      },
    },
  })
  .mount('#app');
