import { Platform } from "react-native";

const MapTabScreen =
  Platform.OS === "web"
    ? require("./MapTabScreen.web").default
    : require("./MapTabScreen.native").default;

export default MapTabScreen;
