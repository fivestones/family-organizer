// Family Organizer
// http://localhost:3000/dash?s=main&t=home&app=af77353a-0a48-455f-b892-010232a052b4

import { i } from "@instantdb/react";

const INSTANT_APP_ID = "af77353a-0a48-455f-b892-010232a052b4";

const graph = i.graph(
  INSTANT_APP_ID,
  {
    "calendarItems": i.entity({
      "dayOfMonth": i.any().indexed(),
      "description": i.any(),
      "endDate": i.any(),
      "isAllDay": i.any(),
      "month": i.any().indexed(),
      "startDate": i.any(),
      "title": i.any(),
      "year": i.any().indexed(),
    }),
    "goals": i.entity({
      "createdAt": i.any(),
      "title": i.any(),
    }),
    "messages": i.entity({
      "createdAt": i.any(),
      "text": i.any(),
      "updatedAt": i.any(),
    }),
    "test": i.entity({
  
    }),
    "todos": i.entity({
      "createdAt": i.any(),
      "done": i.any(),
      "text": i.any(),
    }),
  },
  {}
);

export default graph;
