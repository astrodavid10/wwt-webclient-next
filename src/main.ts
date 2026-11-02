import { createApp } from "vue";
import { createPinia } from "pinia";
import { WWTComponent, wwtPinia } from "@wwtelescope/engine-pinia";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { library } from "@fortawesome/fontawesome-svg-core";
import {
  faArrowUpRightFromSquare, faBullseye, faCheck, faChevronDown, faChevronLeft, faChevronRight,
  faChevronUp, faCompass, faCrosshairs, faEye, faEyeSlash, faGear, faImage, faLayerGroup,
  faMagnifyingGlass, faPlus, faSatelliteDish, faShareNodes, faStar, faThumbtack, faXmark,
  faFolderOpen, faRoute, faPlay, faArrowLeft, faTriangleExclamation, faPause, faBackwardStep, faForwardStep, faFilm,
} from "@fortawesome/free-solid-svg-icons";

import "./engine-patches";
import "./tile-quality";
import "./assets/app.less";
import App from "./App.vue";

library.add(
  faArrowUpRightFromSquare, faBullseye, faCheck, faChevronDown, faChevronLeft, faChevronRight,
  faChevronUp, faCompass, faCrosshairs, faEye, faEyeSlash, faGear, faImage, faLayerGroup,
  faMagnifyingGlass, faPlus, faSatelliteDish, faShareNodes, faStar, faThumbtack, faXmark,
  faFolderOpen, faRoute, faPlay, faArrowLeft, faTriangleExclamation, faPause, faBackwardStep, faForwardStep, faFilm,
);

// engine-pinia bundles its own copy of Pinia, so wwtPinia only serves the
// engine store. The app's own stores (the mixer) get a separate instance,
// installed FIRST: engine-pinia's component maps its actions through
// `this.$pinia`, which must end up pointing at wwtPinia.
createApp(App)
  .use(createPinia())
  .use(wwtPinia)
  .component("WorldWideTelescope", WWTComponent)
  .component("font-awesome-icon", FontAwesomeIcon)
  .mount("#app");
