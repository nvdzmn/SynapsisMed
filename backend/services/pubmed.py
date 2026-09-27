"""Small, defensive client for NCBI PubMed E-utilities."""
import xml.etree.ElementTree as et
import httpx

SEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
FETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"

async def fetch_pubmed_abstracts(query: str, max_results: int = 3) -> list[dict]:
    params = {"db": "pubmed", "term": query, "retmode": "json", "retmax": max_results, "sort": "pub_date"}
    async with httpx.AsyncClient(timeout=12.0, headers={"User-Agent": "SynapseMed/0.1 clinical-demo"}) as client:
        search = await client.get(SEARCH_URL, params=params)
        search.raise_for_status()
        result = search.json().get("esearchresult", {})
        if result.get("ERROR"):
            raise RuntimeError(str(result["ERROR"]))
        pmids = result.get("idlist", [])
        if not pmids:
            return []
        response = await client.get(FETCH_URL, params={"db": "pubmed", "id": ",".join(pmids), "retmode": "xml"})
        response.raise_for_status()
    root = et.fromstring(response.content)
    articles = []
    for article in root.findall(".//PubmedArticle"):
        title = "".join(article.find(".//ArticleTitle").itertext()) if article.find(".//ArticleTitle") is not None else "Untitled study"
        abstract = " ".join("".join(item.itertext()) for item in article.findall(".//Abstract/AbstractText"))
        articles.append({
            "pmid": article.findtext(".//MedlineCitation/PMID", "Unknown"),
            "title": title,
            "abstract": abstract[:5000],
            "journal": article.findtext(".//Journal/Title", "Medical journal"),
            "publication_date": article.findtext(".//PubDate/Year", "Recent"),
            "key_findings": abstract[:320] if abstract else "Abstract unavailable; clinician review required."
        })
    return articles
