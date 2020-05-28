
# ValOS style guide
[//]: # (don't edit auto-generated file - generated at @valos/kernel
root with)
[//]: # (vlm --markdown . require
packages/type-vault/template.vdon/STYLE.vdon > STYLE.md)
The ValOS style is split into three main sections: general semantic
principles, informal text production guidelines and formal
linter-enforceable style rules.
Additional files specifying formal style rules:
- @valos/type-vault/shared/.eslintrc.js
- @valos/type-vault/templates/.editorconfig

Note: while formal ValOS linter rules are formally based on airbnb
style there is a lot of divergence in practice.

Like all ValOS specifications this style guide applies only to Valaa
Open System packages. Other ValOS ecosystem packages and projects are
free to deviate or use their own styles and principles without
affecting ValOS compatibility.

## Semantic principles
key          |value                                                                                                                                                                                                                                                                                                                                                                                                                
-------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
0            |This section lists generic semantic ValOS design principles and
      their rationales.                                                                                                                                                                                                                                                                                                                              
useBase64URL |(a base64 variant) must be used when binary content needs to be
      encoded as text. While main binary content is stored inside Media
      resources which has its dedicated pathways this need can still
      arise. This is recommended by I-JSON and a notable ValOS example
      is derived resource ID creation via hash algorithms (which
      operate on binary content) which should be url-compatible.
useECMAScript|When solutions necessitate other languages, they should be
      implemented in following order of preference:                                                                                                                                                                                                                                                                                                       
useJSON      |Some dialects make use of some shared tooling like
      @valos/tools/deepExpand                                                                                                                                                                                                                                                                                                                                     

## Informal text production style guidelines
This section lists informal style rules which relate to production of
text. That text can be human or machine written code, command line or
log output, or even documentation. Any rule that can, should be
expressed as a formal eslint or editor rule.

### collectionPluralization
@valos/tools is plural as it is a collection of largely independent
tools.

### Style CSS according to camelCase BEM.info rules
key          |value                                                                                                                                                                                                                                                                                                                                                                                                    
-------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
0            |[BEM (Block, Element, Modifier)](https://en.bem.info/methodology/quick-start/)
        is a component-based approach to web development. ValOS uses
        [the camelCase naming convention](https://en.bem.info/methodology/naming-convention/)
        with option library-scope prefix described below.
        BEM principles should be followed more generally as well whenever
        applicable.
scopePrefixes|In addition to its own styles @valos/inspire hosts several
        programs within the same page which share the same global
        css namespace. BEM naming is extended to allow a block name
        to be prefixed with a scope name and two underscores like so:
        'inspire__' to prevent conflicts.                                                                                         

### lineWidth
This choice should be followed consistently everywhere within the same
tool or document.

## Git branch, versioning and release workflows
The following guidelines describe the current practice but should be
still considered only as a proposal.

### Vault semver version number is shared between all packages
Vault version numbers follow [semver
2](https://semver.org/spec/v2.0.0.html) specification. Vault uses lerna
locked mode versioning for its packages by default. Only actually
modified packages will have their version numbers updated when
released. When a package is updated however the version number then
potentially jumps over any skipped versions to match the shared vault
version.

### Vault git branch naming and semantics
key       |value                                                                                                                                                                                                                                                                                                                                                                                   
----------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
0         |Branches.                                                                                                                                                                                                                                                                                                                                                                               
feature   |Feature owner is free to pick whichever workflow fits the
        dynamics of that particular feature development best.
        No matter the workflow that is chosen the final pull
        request must rebased on top of the prerelease branch.                                                                                                                                      
master    |An alias for the most recent release branch. Follows all
        the rules of a release branch.                                                                                                                                                                                                                                                                                         
patch     |The content must obey semver patch version rules. Note
        that major version 0 allows patch versions to introduce new
        functionality. These _quickie features_ facilitate rapid
        development during prototyping stage only and thus are not
        allowed for major versions >= 1.                                                                                 
prerelease|When being released may be squelched and rebased on top
        of master. Alternatively it's left as-is to be the target
        of fast-forward later. A release commit will be added
        to contain lerna.json and other release version number
        changes. The branch can then be renamed as the appropriate
        release branch, and master fast-forwarded to track it.
release   |A release branch is deleted once support for that
        particular release ends, ie. when that release will no
        longer receive patches.                                                                                                                                                                                                                                        
