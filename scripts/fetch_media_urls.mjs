import "../meta/env.js";
import { get } from "../meta/graph.js";

const ids = [
  "17971424193140150", // Learning hits different when you experience it
  "18116218471960252", // From 82% - Divyansh
  "17947935894338002", // Apurv 93%
  "18123666274893703", // strong future starts with a strong foundation
  "18224548573327848", // place where learning goes beyond the classroom
  "17970361356161135", // Welcome to QLASS Learning
  "18112667975012344", // Learning is more than just sitting in a classroom
  "17996999100007332", // doubts had an answer
  "18132413374673882", // Chahe Board ho chahe NEET
  "18010272869967402", // 1000 problems one better way
];

for (const id of ids) {
  try {
    const m = await get(`/${id}`, { fields: "media_type,media_product_type,media_url,thumbnail_url,caption" });
    console.log(JSON.stringify({ id, ...m }));
  } catch (e) {
    console.log(JSON.stringify({ id, error: e.message }));
  }
}
