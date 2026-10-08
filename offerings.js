// Everything a customer can be invited to review. Edit this list to add or rename an offering;
// the admin invitation form and the public Voices page both read from it.
// "page" is the site address where that offering's reviews also appear (omit if it has no page of its own).
const CATEGORIES = [
  { id: "ecourse", label: "E-Courses", label1: "E-Course", verified: "Verified Participant" },
  { id: "zoom", label: "Live Classes", label1: "Live Class", verified: "Verified Participant" },
  { id: "journalclub", label: "Journal Club", label1: "Journal Club", verified: "Verified Participant" },
  { id: "books", label: "Books", label1: "Book", verified: "Verified Purchaser" },
  { id: "journals", label: "Journals", label1: "Journal", verified: "Verified Purchaser" },
  { id: "merch", label: "Lifestyle Products", label1: "Lifestyle Product", verified: "Verified Purchaser" },
];

const OFFERINGS = [
  { id: "course-root", category: "ecourse", name: "Breaking the Chains (Root Chakra Course)", page: "courses/root" },
  { id: "course-sacral", category: "ecourse", name: "Reclaiming Creation (Sacral Chakra Course)", page: "courses/sacral" },
  { id: "course-solar", category: "ecourse", name: "Taking Back My Power (Solar Plexus Chakra Course)", page: "courses/solar-plexus" },
  { id: "course-heart", category: "ecourse", name: "Loving Without Losing Me (Heart Chakra Course)", page: "courses/heart" },
  { id: "course-throat", category: "ecourse", name: "Speak Your Truth (Throat Chakra Course)", page: "courses/throat" },
  { id: "course-thirdeye", category: "ecourse", name: "Seeing Beyond The Pattern (Third Eye Chakra Course)", page: "courses/third-eye" },
  { id: "course-crown", category: "ecourse", name: "Crowned in Purpose (Crown Chakra Course)", page: "courses/crown" },
  { id: "zoom-7week", category: "zoom", name: "The 7-Week Root-to-Crown Experience (live on Zoom)", page: "programs" },
  { id: "zoom-class", category: "zoom", name: "Live Zoom Class or Workshop", page: "programs" },
  { id: "journalclub", category: "journalclub", name: "Rooted & Crowned Journal Club", page: "programs" },
  { id: "book-survival", category: "books", name: "A Journey from Survival to Healing", page: "books" },
  { id: "book-practitioner", category: "books", name: "Practitioner Double Book Series", page: "books" },
  { id: "book-other", category: "books", name: "Another Rooted & Crowned book", page: "books" },
  { id: "journal-journey", category: "journals", name: "My Rooted & Crowned Journey", page: "books" },
  { id: "journal-words", category: "journals", name: "Rooted in Words, Crowned in Truth", page: "books" },
  { id: "journal-daily", category: "journals", name: "Rooted and Crowned Daily Journal", page: "books" },
  { id: "journal-other", category: "journals", name: "Another Rooted & Crowned journal", page: "books" },
  { id: "merch", category: "merch", name: "Rooted & Crowned merchandise", page: "shop" },
];

module.exports = { CATEGORIES, OFFERINGS };
