
const text = "C 1 by 5, Sarathi CHS, Khira Nagar, S V Road, Santacruz Vashish@blume.vc";
const regex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i;
const match = text.match(regex);
console.log(match ? match[0] : "no match");
