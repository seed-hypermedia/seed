# Site Dashboard

A read-only overview of the site this extension is installed on:

- stat tiles: document count, total comments, unique authors;
- every document in the space with its path, last update, authors and comment count (`Query`, mode `AllDescendants`);
- recent activity across the space (`ListEvents` filtered to `hm://<site>*`);
- a search box (`Search` scoped to the site).

Clicking a document or a search result navigates the host to it. The only permission it needs is `navigate`; everything
else uses the read-only query bridge that every extension has.

Copy it when you want an extension that reads and presents site data without writing anything.
