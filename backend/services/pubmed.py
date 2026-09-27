"""Literature retrieval with PubMed primary and Europe PMC fallback."""
import asyncio
import xml.etree.ElementTree as et
import httpx

SEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
FETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
EUROPE_PMC_SEARCH_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"

def _publication_date(article) -> str:
    return article.findtext(".//PubDate/Year") or article.findtext(".//ArticleDate/Year") or "Recent"

async def fetch_europe_pmc_abstracts(query: str, max_results: int = 3) -> list[dict]:
    """Return source-labeled biomedical records from Europe PMC's REST API."""
    params = {"query": query, "format": "json", "resultType": "core", "pageSize": max_results, "sort": "P_PDATE_D"}
    async with httpx.AsyncClient(timeout=15.0, headers={"User-Agent": "SynapseMed/0.1 clinical-demo"}) as client:
        last_error = None
        for attempt in range(3):
            try:
                response = await client.get(EUROPE_PMC_SEARCH_URL, params=params)
                response.raise_for_status()
                break
            except httpx.HTTPError as error:
                last_error = error
                if attempt == 2:
                    raise
                await asyncio.sleep(0.5 * (attempt + 1))
    records = response.json().get("resultList", {}).get("result", [])
    articles = []
    for record in records:
        pmid = record.get("pmid")
        record_id = record.get("id") or pmid
        if not record_id:
            continue
        source = record.get("source", "MED")
        articles.append({
            "pmid": pmid,
            "source_id": f"pmid:{pmid}" if pmid else f"europepmc:{record_id}",
            "source": "europe_pmc",
            "source_url": f"https://europepmc.org/article/{source}/{record_id}",
            "title": record.get("title") or "Untitled study",
            "abstract": (record.get("abstractText") or "")[:5000],
            "journal": record.get("journalTitle") or record.get("journal") or "Medical journal",
            "publication_date": record.get("firstPublicationDate") or record.get("pubYear") or "Recent",
            "key_findings": (record.get("abstractText") or "Abstract unavailable; clinician review required.")[:320],
        })
    return articles

async def fetch_pubmed_abstracts(query: str, max_results: int = 3) -> list[dict]:
    """Fetch PubMed records, then use Europe PMC only if PubMed is unavailable/empty."""
    try:
        params = {"db": "pubmed", "term": query, "retmode": "json", "retmax": max_results, "sort": "pub_date", "tool": "SynapseMed"}
        async with httpx.AsyncClient(timeout=12.0, headers={"User-Agent": "SynapseMed/0.1 clinical-demo"}) as client:
            search = await client.get(SEARCH_URL, params=params)
            search.raise_for_status()
            result = search.json().get("esearchresult", {})
            if result.get("ERROR"):
                raise RuntimeError(str(result["ERROR"]))
            pmids = result.get("idlist", [])
            if not pmids:
                return await fetch_europe_pmc_abstracts(query, max_results)
            response = await client.get(FETCH_URL, params={"db": "pubmed", "id": ",".join(pmids), "retmode": "xml", "tool": "SynapseMed"})
            response.raise_for_status()
    except (httpx.HTTPError, ValueError, et.ParseError, RuntimeError):
        return await fetch_europe_pmc_abstracts(query, max_results)
    root = et.fromstring(response.content)
    articles = []
    for article in root.findall(".//PubmedArticle"):
        title = "".join(article.find(".//ArticleTitle").itertext()) if article.find(".//ArticleTitle") is not None else "Untitled study"
        abstract = " ".join("".join(item.itertext()) for item in article.findall(".//Abstract/AbstractText"))
        articles.append({
            "pmid": article.findtext(".//MedlineCitation/PMID", "Unknown"),
            "source_id": f"pmid:{article.findtext('.//MedlineCitation/PMID', 'Unknown')}",
            "source": "pubmed",
            "source_url": None,
            "title": title,
            "abstract": abstract[:5000],
            "journal": article.findtext(".//Journal/Title", "Medical journal"),
            "publication_date": _publication_date(article),
            "key_findings": abstract[:320] if abstract else "Abstract unavailable; clinician review required."
        })
    return articles
